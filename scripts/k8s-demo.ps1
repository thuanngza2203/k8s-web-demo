param(
  [ValidateSet("balance", "scale", "self-heal", "api-down", "all")]
  [string]$Scenario = "balance",
  [ValidateRange(10, 1000)]
  [int]$Requests = 120,
  [ValidateRange(4, 10)]
  [int]$ScaleReplicas = 5,
  [ValidateRange(150, 600)]
  [int]$ApiDownSeconds = 150
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$env:HTTP_PROXY = ""
$env:HTTPS_PROXY = ""
$env:ALL_PROXY = ""

$Namespace = "cloud-web-k8s"
function Invoke-Kubectl {
  param([string[]]$Arguments)

  & kubectl @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "kubectl command failed: kubectl $($Arguments -join ' ')"
  }
}

function Invoke-KubectlWithInput {
  param(
    [string]$InputText,
    [string[]]$Arguments
  )

  $InputText | & kubectl @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "kubectl command with stdin failed: kubectl $($Arguments -join ' ')"
  }
}

function Get-ApiReplicaState {
  $deploymentJson = & kubectl -n $Namespace get deployment api -o json
  if ($LASTEXITCODE -ne 0) {
    throw "Could not read the API deployment."
  }

  $deployment = $deploymentJson | ConvertFrom-Json
  return @{
    Desired = [int]($deployment.spec.replicas)
    Available = [int]($deployment.status.availableReplicas)
  }
}

function Test-ClusterReady {
  Invoke-Kubectl -Arguments @("-n", $Namespace, "get", "deployment", "api") | Out-Null
  Invoke-Kubectl -Arguments @("-n", $Namespace, "get", "deployment", "frontend") | Out-Null
}

function Assert-ApiAvailable {
  $state = Get-ApiReplicaState
  if ($state.Desired -lt 1 -or $state.Available -lt 1) {
    throw "API has $($state.Desired) desired and $($state.Available) available replicas. Recover it with: kubectl -n $Namespace scale deployment/api --replicas=3"
  }
}

function Show-ApiPods {
  Invoke-Kubectl -Arguments @("-n", $Namespace, "get", "pods", "-l", "app=api", "-o", "wide")
}

function Restart-LocalForwards {
  $forwardScript = Join-Path $PSScriptRoot "local-forward.ps1"
  if (Test-Path $forwardScript) {
    Write-Host "Refreshing localhost port-forwards after API pod replacement."
    & $forwardScript
  }
}

function Invoke-ServiceLoadBalance {
  param([int]$RequestCount = $Requests)

  Assert-ApiAvailable

  Write-Host ""
  Write-Host "=== KUBERNETES SERVICE LOAD BALANCING ==="
  Write-Host "Sending $RequestCount new TCP connections from a frontend pod to http://api:8081/api/instance"
  Write-Host ""

  Invoke-Kubectl -Arguments @("-n", $Namespace, "get", "endpoints", "api", "-o", "wide")

  $nodeScript = @'
const http = require("http");
const total = Number(process.argv.at(-1));
const distribution = {};
let success = 0;
let failed = 0;

function requestInstance() {
  return new Promise((resolve) => {
    const request = http.get(
      "http://api:8081/api/instance",
      { agent: false, headers: { Connection: "close" } },
      (response) => {
        let body = "";
        response.on("data", (chunk) => { body += chunk; });
        response.on("end", () => {
          try {
            const payload = JSON.parse(body);
            const pod = payload.data && payload.data.pod_name
              ? payload.data.pod_name
              : "unknown";
            distribution[pod] = (distribution[pod] || 0) + 1;
            success += 1;
          } catch {
            failed += 1;
          }
          resolve();
        });
      },
    );

    request.on("error", () => {
      failed += 1;
      resolve();
    });
  });
}

(async () => {
  await Promise.all(Array.from({ length: total }, requestInstance));
  process.stdout.write(JSON.stringify({ total, success, failed, distribution }, null, 2));
})();
'@

  Invoke-KubectlWithInput -InputText $nodeScript -Arguments @(
    "-n", $Namespace,
    "exec", "-i", "deployment/frontend",
    "--", "node", "-", [string]$RequestCount
  )

  Write-Host ""
  Write-Host "Expected: distribution contains multiple api-* pod names."
  Write-Host "Grafana: Application Overview -> API Requests By Pod"
}

function Invoke-ScaleDemo {
  Assert-ApiAvailable

  $originalReplicas = [int](& kubectl -n $Namespace get deployment api -o jsonpath="{.spec.replicas}")
  if ($LASTEXITCODE -ne 0) {
    throw "Could not read the current API replica count."
  }

  Write-Host ""
  Write-Host "=== KUBERNETES HORIZONTAL SCALE DEMO ==="
  Write-Host "Scaling API from $originalReplicas to $ScaleReplicas replicas."

  $scaled = $false
  try {
    Invoke-Kubectl -Arguments @("-n", $Namespace, "scale", "deployment/api", "--replicas=$ScaleReplicas")
    $scaled = $true
    Invoke-Kubectl -Arguments @("-n", $Namespace, "rollout", "status", "deployment/api", "--timeout=180s")
    Show-ApiPods
    Invoke-ServiceLoadBalance -RequestCount $Requests
  } finally {
    if ($scaled) {
      Write-Host ""
      Write-Host "Restoring API to $originalReplicas replicas."
      Invoke-Kubectl -Arguments @("-n", $Namespace, "scale", "deployment/api", "--replicas=$originalReplicas")
      Invoke-Kubectl -Arguments @("-n", $Namespace, "rollout", "status", "deployment/api", "--timeout=180s")
      Restart-LocalForwards
    }
  }
}

function Invoke-SelfHealingDemo {
  Assert-ApiAvailable

  Write-Host ""
  Write-Host "=== KUBERNETES SELF-HEALING DEMO ==="
  Write-Host "API pods before deletion:"
  Show-ApiPods

  $podName = (& kubectl -n $Namespace get pods -l app=api -o jsonpath="{.items[0].metadata.name}")
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($podName)) {
    throw "Could not select an API pod for the self-healing demo."
  }

  Write-Host ""
  Write-Host "Deleting pod $podName."
  Invoke-Kubectl -Arguments @("-n", $Namespace, "delete", "pod", $podName)
  Invoke-Kubectl -Arguments @("-n", $Namespace, "rollout", "status", "deployment/api", "--timeout=180s")

  Write-Host ""
  Write-Host "API pods after Deployment reconciliation:"
  Show-ApiPods
  Invoke-ServiceLoadBalance -RequestCount ([Math]::Max(30, [Math]::Floor($Requests / 2)))
  Restart-LocalForwards
}

function Invoke-ApiDownDemo {
  $state = Get-ApiReplicaState
  $originalReplicas = $state.Desired
  if ($originalReplicas -lt 1) {
    $originalReplicas = 3
    Write-Host "API is already scaled to zero; it will be restored to 3 replicas after the demo."
  }

  Write-Host ""
  Write-Host "=== API DOWN + GRAFANA + GEMINI + TELEGRAM ==="
  Write-Host "Scaling API to zero for $ApiDownSeconds seconds."
  Write-Host "Watch Grafana Alert Overview and Telegram while this script waits."
  Write-Host ""

  try {
    Invoke-Kubectl -Arguments @("-n", $Namespace, "scale", "deployment/api", "--replicas=0")
    $apiPods = @(& kubectl -n $Namespace get pods -l app=api -o name)
    if ($LASTEXITCODE -ne 0) {
      throw "Could not list API pods after scaling down."
    }
    if ($apiPods.Count -gt 0) {
      Invoke-Kubectl -Arguments @("-n", $Namespace, "wait", "--for=delete", "pod", "-l", "app=api", "--timeout=180s")
    }

    for ($remaining = $ApiDownSeconds; $remaining -gt 0; $remaining -= 15) {
      Write-Host "  API down: $remaining seconds remaining..."
      Start-Sleep -Seconds ([Math]::Min(15, $remaining))
    }

    Write-Host ""
    Write-Host "Recent Alert AI logs:"
    Invoke-Kubectl -Arguments @("-n", $Namespace, "logs", "deployment/alert-ai", "--tail=40")
  } finally {
    Write-Host ""
    Write-Host "Restoring API to $originalReplicas replicas."
    Invoke-Kubectl -Arguments @("-n", $Namespace, "scale", "deployment/api", "--replicas=$originalReplicas")
    Invoke-Kubectl -Arguments @("-n", $Namespace, "rollout", "status", "deployment/api", "--timeout=180s")
    Show-ApiPods
    Restart-LocalForwards
  }
}

Test-ClusterReady

switch ($Scenario) {
  "balance" { Invoke-ServiceLoadBalance }
  "scale" { Invoke-ScaleDemo }
  "self-heal" { Invoke-SelfHealingDemo }
  "api-down" { Invoke-ApiDownDemo }
  "all" {
    Invoke-ServiceLoadBalance
    Invoke-ScaleDemo
    Invoke-SelfHealingDemo
  }
}

Write-Host ""
Write-Host "Kubernetes scenario '$Scenario' complete."
