Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$env:HTTP_PROXY = ""
$env:HTTPS_PROXY = ""
$env:ALL_PROXY = ""

$Namespace = "cloud-web-k8s"
$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$LogDir = Join-Path $ProjectRoot "tmp"

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

$forwards = @(
  @{ Name = "frontend"; LocalPort = 3000; Service = "svc/frontend"; RemotePort = 3000; HealthPath = "/" },
  @{ Name = "api"; LocalPort = 8081; Service = "svc/api"; RemotePort = 8081; HealthPath = "/health" },
  @{ Name = "alert-ai"; LocalPort = 8082; Service = "svc/alert-ai"; RemotePort = 8082; HealthPath = "/ready" },
  @{ Name = "prometheus"; LocalPort = 9090; Service = "svc/prometheus"; RemotePort = 9090; HealthPath = "/-/ready" },
  @{ Name = "grafana"; LocalPort = 4000; Service = "svc/grafana"; RemotePort = 3000; HealthPath = "/api/health" }
)

Write-Host "Stopping old kubectl processes so stale port-forwards cannot survive pod replacement..."
Get-Process kubectl -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 1

foreach ($forward in $forwards) {
  $logFile = Join-Path $LogDir "port-forward-$($forward.Name).log"
  $command = @"
`$env:HTTP_PROXY=''
`$env:HTTPS_PROXY=''
`$env:ALL_PROXY=''
kubectl -n $Namespace port-forward $($forward.Service) $($forward.LocalPort):$($forward.RemotePort) *> '$logFile'
"@

  Write-Host "Starting port-forward for $($forward.Name) on localhost:$($forward.LocalPort)..."
  Write-Host "  log: $logFile"
  Start-Process powershell `
    -WindowStyle Hidden `
    -ArgumentList @("-NoProfile", "-Command", $command)
}

Start-Sleep -Seconds 5

function Test-ForwardHealth {
  param([hashtable]$Forward)

  try {
    $response = Invoke-WebRequest `
      -UseBasicParsing `
      -Uri "http://127.0.0.1:$($Forward.LocalPort)$($Forward.HealthPath)" `
      -TimeoutSec 5
    return $response.StatusCode -ge 200 -and $response.StatusCode -lt 500
  } catch {
    return $false
  }
}

Write-Host "Port forwards:"
Write-Host "  Frontend   http://localhost:3000"
Write-Host "  API        http://localhost:8081"
Write-Host "  Alert AI   http://localhost:8082"
Write-Host "  Prometheus http://localhost:9090"
Write-Host "  Grafana    http://localhost:4000"

Write-Host "Checking HTTP health..."
foreach ($forward in $forwards) {
  if (Test-ForwardHealth -Forward $forward) {
    Write-Host "  OK   $($forward.Name) localhost:$($forward.LocalPort)"
  } else {
    $logFile = Join-Path $LogDir "port-forward-$($forward.Name).log"
    Write-Host "  WARN $($forward.Name) is not healthy. Check $logFile"
  }
}
