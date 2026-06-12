param(
  [string]$BaseUrl = "http://localhost:8081",
  [string]$PrometheusUrl = "http://localhost:9090",
  [ValidateSet("normal", "auth", "shopping", "burst", "error", "error-alert", "slow", "cpu", "memory", "db", "db-error", "all")]
  [string]$Scenario = "all"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Continue"

$Namespace = "cloud-web-k8s"
$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$LogDir = Join-Path $ProjectRoot "tmp"
$script:SuccessCount = 0
$script:FailureCount = 0

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$env:HTTP_PROXY = ""
$env:HTTPS_PROXY = ""
$env:ALL_PROXY = ""

function Invoke-DemoRequest {
  param(
    [string]$Method = "GET",
    [string]$Path,
    [string]$Body = "",
    [int]$TimeoutSec = 20,
    [switch]$AllowHttpError,
    [hashtable]$Headers = @{}
  )

  try {
    $uri = "$BaseUrl$Path"
    $allHeaders = @{ "Content-Type" = "application/json" }
    foreach ($key in $Headers.Keys) {
      $allHeaders[$key] = $Headers[$key]
    }

    if ([string]::IsNullOrWhiteSpace($Body)) {
      $response = Invoke-WebRequest -UseBasicParsing -Method $Method -Uri $uri -TimeoutSec $TimeoutSec -Headers $allHeaders
      $script:SuccessCount += 1
      return $response
    }

    $response = Invoke-WebRequest `
      -UseBasicParsing `
      -Method $Method `
      -Uri $uri `
      -ContentType "application/json" `
      -Body $Body `
      -TimeoutSec $TimeoutSec `
      -Headers $allHeaders
    $script:SuccessCount += 1
    return $response
  } catch {
    $response = $_.Exception.Response
    if ($AllowHttpError -and $response) {
      $script:SuccessCount += 1
      return $response
    }

    $script:FailureCount += 1
    return $null
  }
}

function Invoke-DemoGet {
  param(
    [string]$Path,
    [int]$TimeoutSec = 20,
    [switch]$AllowHttpError,
    [hashtable]$Headers = @{}
  )

  Invoke-DemoRequest -Method "GET" -Path $Path -TimeoutSec $TimeoutSec -AllowHttpError:$AllowHttpError -Headers $Headers | Out-Null
}

function Test-ApiReachable {
  Write-Host "Checking API health at $BaseUrl/health..."
  $health = Invoke-DemoRequest -Path "/health" -TimeoutSec 5

  if (-not $health) {
    Write-Host "API is not reachable. Trying to start API port-forward..."
    Start-ApiPortForward
    Start-Sleep -Seconds 4
    $health = Invoke-DemoRequest -Path "/health" -TimeoutSec 5
  }

  if (-not $health) {
    throw "API is not reachable at $BaseUrl. Check tmp/port-forward-api.log, then run '.\scripts\local-forward.ps1' if needed."
  }

  Write-Host "API reachable."
  $script:SuccessCount = 0
  $script:FailureCount = 0
}

function Start-ApiPortForward {
  $logFile = Join-Path $LogDir "port-forward-api.log"
  $command = "kubectl -n $Namespace port-forward svc/api 8081:8081 *> `"$logFile`""
  Start-Process powershell -WindowStyle Hidden -ArgumentList @("-NoExit", "-Command", $command)
  Write-Host "Started API port-forward. Log: $logFile"
}

function Get-AuthToken {
  param([string]$Username = "alice", [string]$Password = "password123")

  $body = @{ username = $Username; password = $Password } | ConvertTo-Json
  $response = Invoke-DemoRequest -Method "POST" -Path "/api/auth/login" -Body $body
  if ($response) {
    $payload = $response.Content | ConvertFrom-Json
    return $payload.data.token
  }
  return $null
}

function Get-PrometheusScalar {
  param([string]$Query)

  try {
    $encodedQuery = [Uri]::EscapeDataString($Query)
    $response = Invoke-RestMethod `
      -Method "GET" `
      -Uri "$PrometheusUrl/api/v1/query?query=$encodedQuery" `
      -TimeoutSec 10

    if ($response.status -ne "success") {
      throw "Prometheus returned status '$($response.status)'."
    }

    $results = @($response.data.result)
    if ($results.Count -eq 0) {
      return 0.0
    }

    return [double]::Parse(
      [string]$results[0].value[1],
      [Globalization.CultureInfo]::InvariantCulture
    )
  } catch {
    throw "Prometheus is not reachable at $PrometheusUrl or the query failed: $($_.Exception.Message)"
  }
}

function Invoke-ErrorBatches {
  param(
    [int]$BatchCount,
    [int]$RequestsPerBatch,
    [int]$DelaySeconds
  )

  for ($batch = 1; $batch -le $BatchCount; $batch++) {
    for ($request = 1; $request -le $RequestsPerBatch; $request++) {
      Invoke-DemoGet "/api/simulate/error" -AllowHttpError
    }

    Write-Host "  Error batch $batch/$BatchCount sent ($RequestsPerBatch requests)."
    if ($batch -lt $BatchCount -and $DelaySeconds -gt 0) {
      Start-Sleep -Seconds $DelaySeconds
    }
  }
}

function Wait-ForPrometheusErrorMetric {
  param(
    [double]$BeforeTotal,
    [int]$TimeoutSeconds = 40
  )

  Write-Host "Waiting for Prometheus to scrape the updated error counter..."
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)

  do {
    Start-Sleep -Seconds 5
    $currentTotal = Get-PrometheusScalar -Query "sum(app_http_errors_total)"
    if ($currentTotal -gt $BeforeTotal) {
      $increase = $currentTotal - $BeforeTotal
      $errorRate = Get-PrometheusScalar -Query "(sum(increase(app_http_errors_total[5m])) / clamp_min(sum(increase(app_http_requests_total[5m])), 1)) * 100"
      Write-Host "Prometheus observed $([math]::Round($increase, 2)) new HTTP errors."
      Write-Host "Current five-minute API error rate: $([math]::Round($errorRate, 2)) percent."
      return
    }
  } while ((Get-Date) -lt $deadline)

  throw "Prometheus did not observe a higher app_http_errors_total value within $TimeoutSeconds seconds. Check Prometheus targets and API /metrics."
}

# Scenario: Normal Traffic
function Invoke-NormalTraffic {
  Write-Host ""
  Write-Host "=== SCENARIO: Normal Traffic ==="
  Write-Host "    Grafana: Application Overview -> Request Rate, Latency"
  Write-Host ""

  for ($i = 1; $i -le 50; $i++) {
    Invoke-DemoGet "/health"
    Invoke-DemoGet "/api/products"
  }

  Invoke-DemoGet "/api/products/categories"

  for ($i = 1; $i -le 10; $i++) {
    Invoke-DemoGet "/api/products?category=electronics"
    Invoke-DemoGet "/api/products?category=audio"
    Invoke-DemoGet "/api/products?search=wireless"
  }

  Write-Host "Normal traffic complete."
}

# Scenario: Auth Traffic
function Invoke-AuthTraffic {
  Write-Host ""
  Write-Host "=== SCENARIO: Auth Traffic ==="
  Write-Host "    Grafana: Application Overview -> Business Events (user_login, user_registered)"
  Write-Host ""

  # Login with each seeded user
  foreach ($username in @("alice", "bob", "charlie", "diana")) {
    $body = @{ username = $username; password = "password123" } | ConvertTo-Json
    Invoke-DemoRequest -Method "POST" -Path "/api/auth/login" -Body $body | Out-Null
    Write-Host "  Logged in as $username"
  }

  # Try invalid login
  $badBody = @{ username = "alice"; password = "wrongpass" } | ConvertTo-Json
  Invoke-DemoRequest -Method "POST" -Path "/api/auth/login" -Body $badBody -AllowHttpError | Out-Null
  Write-Host "  Tested invalid login"

  # Register a new user
  $ts = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
  $regBody = @{
    username = "loadtest_$ts"
    email = "loadtest_$ts@test.com"
    password = "testpass123"
    full_name = "Load Test User"
  } | ConvertTo-Json
  Invoke-DemoRequest -Method "POST" -Path "/api/auth/register" -Body $regBody -AllowHttpError | Out-Null
  Write-Host "  Registered new user"

  # Access profile
  $token = Get-AuthToken -Username "alice"
  if ($token) {
    Invoke-DemoGet "/api/auth/me" -Headers @{ Authorization = "Bearer $token" }
    Write-Host "  Accessed profile with JWT"
  }

  Write-Host "Auth traffic complete."
}

# Scenario: Shopping Flow
function Invoke-ShoppingTraffic {
  Write-Host ""
  Write-Host "=== SCENARIO: Shopping Flow ==="
  Write-Host "    Grafana: Application Overview -> Business Events (order_placed)"
  Write-Host "    Grafana: Database Overview -> Query Rate, Latency, Pool"
  Write-Host ""

  $token = Get-AuthToken -Username "alice"
  if (-not $token) {
    Write-Host "  Could not login. Skipping shopping flow."
    return
  }

  $authHeaders = @{ Authorization = "Bearer $token" }

  # Browse products
  Write-Host "  Browsing products..."
  for ($i = 1; $i -le 10; $i++) {
    Invoke-DemoGet "/api/products" -Headers $authHeaders
  }

  # Get products for ordering
  $productsResponse = Invoke-DemoRequest -Path "/api/products" -Headers $authHeaders
  if (-not $productsResponse) {
    Write-Host "  Could not load products."
    return
  }

  $productsPayload = $productsResponse.Content | ConvertFrom-Json
  $products = @($productsPayload.data)

  if ($products.Count -lt 2) {
    Write-Host "  Not enough products to place orders."
    return
  }

  # Place 5 orders
  Write-Host "  Placing orders..."
  for ($i = 1; $i -le 5; $i++) {
    $p1 = $products[($i % $products.Count)]
    $p2 = $products[(($i + 3) % $products.Count)]

    $orderBody = @{
      items = @(
        @{ product_uuid = $p1.uuid; quantity = 1 },
        @{ product_uuid = $p2.uuid; quantity = [math]::Max(1, ($i % 3) + 1) }
      )
    } | ConvertTo-Json -Depth 6

    $orderResponse = Invoke-DemoRequest -Method "POST" -Path "/api/orders" -Body $orderBody -Headers $authHeaders -AllowHttpError
    if ($orderResponse -and $orderResponse.StatusCode -lt 400) {
      Write-Host "    Order $i placed."
    } else {
      Write-Host "    Order ${i}: could not place (stock or other issue)."
    }
  }

  # View orders
  Write-Host "  Viewing orders..."
  for ($i = 1; $i -le 5; $i++) {
    Invoke-DemoGet "/api/orders" -Headers $authHeaders
  }

  Write-Host "Shopping flow complete."
}

# Scenario: Burst Traffic
function Invoke-BurstTraffic {
  Write-Host ""
  Write-Host "=== SCENARIO: Burst Traffic ==="
  Write-Host "    Grafana: Application Overview -> Request Rate spike, Active Requests"
  Write-Host ""

  $jobs = @()
  for ($i = 1; $i -le 80; $i++) {
    $jobs += Start-Job -ScriptBlock {
      param($Url)
      try {
        Invoke-WebRequest -UseBasicParsing -Uri "$Url/api/products" -TimeoutSec 20 | Out-Null
      } catch {}
    } -ArgumentList $BaseUrl
  }

  Wait-Job $jobs | Out-Null
  foreach ($job in $jobs) {
    if ($job.State -eq "Completed") {
      $script:SuccessCount += 1
    } else {
      $script:FailureCount += 1
    }
  }
  Remove-Job $jobs
  Write-Host "Burst traffic complete."
}

# Scenario: Error Traffic
function Invoke-ErrorTraffic {
  Write-Host ""
  Write-Host "=== SCENARIO: Error Traffic ==="
  Write-Host "    Grafana: Application Overview -> Error Rate"
  Write-Host "    Grafana: Alert Overview -> HighAPIErrorRate firing"
  Write-Host ""

  $beforeTotal = Get-PrometheusScalar -Query "sum(app_http_errors_total)"
  Invoke-ErrorBatches -BatchCount 5 -RequestsPerBatch 20 -DelaySeconds 2
  Wait-ForPrometheusErrorMetric -BeforeTotal $beforeTotal
  Write-Host "Error traffic complete."
}

# Scenario: Sustained Error Traffic For Alerting
function Invoke-ErrorAlertTraffic {
  Write-Host ""
  Write-Host "=== SCENARIO: Sustained Error Alert ==="
  Write-Host "    Duration: approximately 3 minutes"
  Write-Host "    Grafana: Application Overview -> API Error Rate"
  Write-Host "    Grafana: Alert Overview -> High API Error Rate firing"
  Write-Host "    Telegram: one grouped notification, protected by cooldown"
  Write-Host ""

  $beforeTotal = Get-PrometheusScalar -Query "sum(app_http_errors_total)"
  Invoke-ErrorBatches -BatchCount 13 -RequestsPerBatch 25 -DelaySeconds 15
  Wait-ForPrometheusErrorMetric -BeforeTotal $beforeTotal

  Write-Host "Waiting for the alert evaluation and notification pipeline..."
  Start-Sleep -Seconds 30
  $firing = Get-PrometheusScalar -Query 'max(ALERTS{alertname="HighAPIErrorRate",alertstate="firing"}) or vector(0)'
  Write-Host "Prometheus HighAPIErrorRate firing value: $([math]::Round($firing, 2))"
  if ($firing -lt 1) {
    Write-Host "Warning: the alert is not firing yet. Keep Grafana on Last 15 minutes and wait for the next rule evaluation."
  }

  Write-Host "Sustained error alert traffic complete."
}

# Scenario: Slow Traffic
function Invoke-SlowTraffic {
  Write-Host ""
  Write-Host "=== SCENARIO: Slow Requests ==="
  Write-Host "    Grafana: Application Overview -> p95/p99 Latency spike"
  Write-Host "    Grafana: Alert Overview -> HighAPILatencyP95 firing"
  Write-Host ""

  $slowJobs = @()
  for ($i = 1; $i -le 20; $i++) {
    $slowJobs += Start-Job -ScriptBlock {
      param($Url)
      try {
        Invoke-WebRequest -UseBasicParsing -Uri "$Url/api/simulate/slow?delay=3000" -TimeoutSec 20 | Out-Null
      } catch {}
    } -ArgumentList $BaseUrl
  }

  Wait-Job $slowJobs | Out-Null
  foreach ($job in $slowJobs) {
    if ($job.State -eq "Completed") {
      $script:SuccessCount += 1
    } else {
      $script:FailureCount += 1
    }
  }
  Remove-Job $slowJobs
  Write-Host "Slow request traffic complete."
}

# Scenario: CPU Load
function Invoke-CpuLoad {
  Write-Host ""
  Write-Host "=== SCENARIO: CPU Load ==="
  Write-Host "    Grafana: Kubernetes Pods -> CPU Usage per Pod"
  Write-Host "    Grafana: Alert Overview -> PodHighCPU"
  Write-Host ""

  for ($i = 1; $i -le 5; $i++) {
    Invoke-DemoGet "/api/simulate/cpu?iterations=20000000" -TimeoutSec 60
  }
  Write-Host "CPU load complete."
}

# Scenario: Memory Load
function Invoke-MemoryLoad {
  Write-Host ""
  Write-Host "=== SCENARIO: Memory Load ==="
  Write-Host "    Grafana: Kubernetes Pods -> RAM Usage per Pod"
  Write-Host "    Grafana: Alert Overview -> PodHighMemory"
  Write-Host ""

  for ($i = 1; $i -le 3; $i++) {
    Invoke-DemoGet "/api/simulate/memory?size=80&hold=90"
  }
  Write-Host "Memory load complete."
}

# Scenario: Database Traffic
function Invoke-DatabaseTraffic {
  Write-Host ""
  Write-Host "=== SCENARIO: Database Traffic ==="
  Write-Host "    Grafana: Database Overview -> Query Rate, Latency, Pool Connections"
  Write-Host ""

  $token = Get-AuthToken -Username "alice"
  $authHeaders = if ($token) { @{ Authorization = "Bearer $token" } } else { @{} }

  # Heavy reads
  for ($i = 1; $i -le 30; $i++) {
    Invoke-DemoGet "/api/products"
    Invoke-DemoGet "/api/users"
    if ($token) {
      Invoke-DemoGet "/api/orders" -Headers $authHeaders
    }
  }

  # Search queries
  foreach ($term in @("mouse", "keyboard", "headset", "watch", "bag", "lamp", "speaker", "cable")) {
    Invoke-DemoGet "/api/products?search=$term"
  }

  # Category queries
  foreach ($cat in @("electronics", "audio", "workspace", "accessories", "wearables")) {
    Invoke-DemoGet "/api/products?category=$cat"
  }

  # Place orders to generate write traffic
  $usersResponse = Invoke-DemoRequest -Path "/api/users"
  $productsResponse = Invoke-DemoRequest -Path "/api/products"

  if (-not $usersResponse -or -not $productsResponse) {
    Write-Host "Could not load seeded users/products. DB read traffic was still generated."
    return
  }

  try {
    $usersPayload = $usersResponse.Content | ConvertFrom-Json
    $productsPayload = $productsResponse.Content | ConvertFrom-Json
    $user = @($usersPayload.data)[0]
    $products = @($productsPayload.data) | Select-Object -First 3

    if (-not $user -or $products.Count -eq 0) {
      Write-Host "Seeded users/products not found. DB read traffic was still generated."
      return
    }

    for ($i = 1; $i -le 8; $i++) {
      $items = @()
      foreach ($product in $products) {
        $items += @{
          product_uuid = $product.uuid
          quantity = 1
        }
      }

      $body = @{
        user_uuid = $user.uuid
        items = $items
      } | ConvertTo-Json -Depth 6

      Invoke-DemoRequest -Method "POST" -Path "/api/orders" -Body $body -TimeoutSec 30 -AllowHttpError | Out-Null
    }
  } catch {
    Write-Host "Could not create demo orders. DB read traffic was still generated."
  }

  Write-Host "Database traffic complete."
}

# Scenario: Database Failure
function Invoke-DatabaseFailureTraffic {
  Write-Host ""
  Write-Host "=== SCENARIO: Database Failure ==="
  Write-Host "    Grafana: Database Overview -> DB Failures / sec"
  Write-Host "    Grafana: Alert Overview -> Database Query Failures"
  Write-Host ""

  for ($i = 1; $i -le 20; $i++) {
    Invoke-DemoGet "/api/simulate/db-error" -AllowHttpError
  }

  Write-Host "Database failure traffic complete."
}

# Main

Test-ApiReachable

Write-Host ""
Write-Host "============================================================"
Write-Host "  Cloud Web K8s - Load Test Script"
Write-Host "  Scenario: $Scenario"
Write-Host "  API: $BaseUrl"
Write-Host "============================================================"
Write-Host ""

switch ($Scenario) {
  "normal" {
    Invoke-NormalTraffic
  }
  "auth" {
    Invoke-AuthTraffic
  }
  "shopping" {
    Invoke-ShoppingTraffic
  }
  "burst" {
    Invoke-BurstTraffic
  }
  "error" {
    Invoke-ErrorTraffic
  }
  "error-alert" {
    Invoke-ErrorAlertTraffic
  }
  "slow" {
    Invoke-SlowTraffic
  }
  "cpu" {
    Invoke-CpuLoad
  }
  "memory" {
    Invoke-MemoryLoad
  }
  "db" {
    Invoke-DatabaseTraffic
  }
  "db-error" {
    Invoke-DatabaseFailureTraffic
  }
  "all" {
    Invoke-NormalTraffic
    Invoke-AuthTraffic
    Invoke-ShoppingTraffic
    Invoke-BurstTraffic
    Invoke-ErrorTraffic
    Invoke-SlowTraffic
    Invoke-CpuLoad
    Invoke-MemoryLoad
    Invoke-DatabaseTraffic
    Invoke-DatabaseFailureTraffic
  }
}

Write-Host ""
Write-Host "============================================"
Write-Host "  Scenario '$Scenario' complete."
Write-Host "  Success: $($script:SuccessCount)"
Write-Host "  Failed:  $($script:FailureCount)"
Write-Host "============================================"
Write-Host ""

if ($script:SuccessCount -eq 0) {
  throw "Scenario '$Scenario' did not complete any successful request. Check API port-forward and service health."
}

if ($script:FailureCount -gt 0) {
  Write-Host "Some requests failed. This can be expected for error demos, but should not happen for normal/burst/db scenarios."
}

Write-Host "Open Grafana at http://localhost:4000 to view dashboards:"
Write-Host "  - Application Overview: request rate, errors, latency, business events"
Write-Host "  - Database Overview: query rate, latency, pool connections"
Write-Host "  - Kubernetes Pods: CPU, RAM, replicas, restarts"
Write-Host "  - Alert Overview: pending/firing alerts"
Write-Host ""
