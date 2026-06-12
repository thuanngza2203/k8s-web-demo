Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$env:HTTP_PROXY = ""
$env:HTTPS_PROXY = ""
$env:ALL_PROXY = ""

$Namespace = "cloud-web-k8s"
$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$K8sDir = Join-Path $ProjectRoot "k8s"
$GrafanaDir = Join-Path $K8sDir "grafana/provisioning"
$DatasourceDir = Join-Path $GrafanaDir "datasources"
$DashboardDir = Join-Path $GrafanaDir "dashboards"
$AlertingDir = Join-Path $GrafanaDir "alerting"
$DotEnvPath = Join-Path $ProjectRoot ".env"

function Invoke-KubectlText {
  param([string[]]$KubectlArgs)

  $previousErrorActionPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $output = & kubectl @KubectlArgs 2>$null
    return @{
      ExitCode = $LASTEXITCODE
      Output = @($output)
    }
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
}

function Read-DotEnvFile {
  param([string]$Path)

  $values = @{}
  if (-not (Test-Path $Path)) {
    return $values
  }

  foreach ($line in Get-Content $Path) {
    $trimmed = $line.Trim()
    if ([string]::IsNullOrWhiteSpace($trimmed) -or $trimmed.StartsWith("#")) {
      continue
    }

    if ($trimmed.StartsWith("export ")) {
      $trimmed = $trimmed.Substring(7).Trim()
    }

    $parts = $trimmed.Split(@("="), 2, [System.StringSplitOptions]::None)
    if ($parts.Count -ne 2) {
      continue
    }

    $name = $parts[0].Trim()
    $value = $parts[1].Trim()
    if (
      $value.Length -ge 2 -and
      (($value.StartsWith('"') -and $value.EndsWith('"')) -or
       ($value.StartsWith("'") -and $value.EndsWith("'")))
    ) {
      $value = $value.Substring(1, $value.Length - 2)
    }

    if (-not [string]::IsNullOrWhiteSpace($name)) {
      $values[$name] = $value
    }
  }

  return $values
}

function Get-ExistingAlertAiSecretValues {
  $values = @{}
  $result = Invoke-KubectlText @(
    "-n", $Namespace,
    "get", "secret", "alert-ai-secret",
    "-o", "json"
  )

  if ($result.ExitCode -ne 0 -or $result.Output.Count -eq 0) {
    return $values
  }

  try {
    $secret = ($result.Output -join "`n") | ConvertFrom-Json
    foreach ($name in @("GEMINI_API_KEY", "TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID")) {
      $property = $secret.data.PSObject.Properties[$name]
      if ($property -and $property.Value) {
        $bytes = [Convert]::FromBase64String([string]$property.Value)
        $values[$name] = [Text.Encoding]::UTF8.GetString($bytes)
      }
    }
  } catch {
    Write-Host "Warning: existing alert-ai-secret could not be read."
  }

  return $values
}

function Test-CredentialValue {
  param([string]$Value)

  if ([string]::IsNullOrWhiteSpace($Value)) {
    return $false
  }

  $normalized = $Value.Trim()
  return -not (
    $normalized.StartsWith("YOUR_", [StringComparison]::OrdinalIgnoreCase) -or
    $normalized.StartsWith("REPLACE_", [StringComparison]::OrdinalIgnoreCase) -or
    $normalized.Equals("CHANGEME", [StringComparison]::OrdinalIgnoreCase)
  )
}

function Resolve-SecretValue {
  param(
    [string]$Name,
    [hashtable]$DotEnvValues,
    [hashtable]$ExistingSecretValues
  )

  $environmentValue = [Environment]::GetEnvironmentVariable($Name)
  if (Test-CredentialValue -Value $environmentValue) {
    return $environmentValue
  }

  if ($DotEnvValues.ContainsKey($Name) -and (Test-CredentialValue -Value $DotEnvValues[$Name])) {
    return [string]$DotEnvValues[$Name]
  }

  if ($ExistingSecretValues.ContainsKey($Name) -and (Test-CredentialValue -Value $ExistingSecretValues[$Name])) {
    return [string]$ExistingSecretValues[$Name]
  }

  return ""
}

function Wait-ForTerminatingPods {
  param([int]$TimeoutSeconds = 60)

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    $result = Invoke-KubectlText @(
      "-n", $Namespace,
      "get", "pods",
      "-o", "json"
    )

    if ($result.ExitCode -eq 0 -and $result.Output.Count -gt 0) {
      try {
        $pods = (($result.Output -join "`n") | ConvertFrom-Json).items
        $terminating = @($pods | Where-Object { $_.metadata.deletionTimestamp })
        if ($terminating.Count -eq 0) {
          return
        }

        Write-Host "Waiting for $($terminating.Count) terminating pod(s) to exit..."
      } catch {
        Write-Host "Warning: could not parse pod status while waiting for termination."
        return
      }
    }

    Start-Sleep -Seconds 2
  } while ((Get-Date) -lt $deadline)

  Write-Host "Warning: some old pods are still terminating; wait before starting port-forward if it disconnects."
}

Write-Host "Using Kubernetes context docker-desktop if available..."
$contextsResult = Invoke-KubectlText @("config", "get-contexts", "-o", "name")
$contexts = @($contextsResult.Output | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })

if (-not ($contexts -contains "docker-desktop")) {
  Write-Host "Available Kubernetes contexts:"
  if ($contexts.Count -eq 0) {
    Write-Host "  (none)"
  } else {
    $contexts | ForEach-Object { Write-Host "  $_" }
  }

  throw "Kubernetes context 'docker-desktop' was not found. Enable Kubernetes in Docker Desktop Settings, wait until it is running, then rerun this script."
}

$currentContextResult = Invoke-KubectlText @("config", "current-context")
$currentContext = if ($currentContextResult.ExitCode -eq 0 -and $currentContextResult.Output.Count -gt 0) {
  $currentContextResult.Output[0]
} else {
  ""
}

if ($currentContext -ne "docker-desktop") {
  kubectl config use-context docker-desktop
}

Write-Host "Applying namespace..."
kubectl apply -f (Join-Path $K8sDir "00-namespace.yaml")

Write-Host "Configuring Alert AI secret if environment variables are available..."
$DotEnvValues = Read-DotEnvFile -Path $DotEnvPath
$ExistingSecretValues = Get-ExistingAlertAiSecretValues
$GeminiApiKey = Resolve-SecretValue -Name "GEMINI_API_KEY" -DotEnvValues $DotEnvValues -ExistingSecretValues $ExistingSecretValues
$TelegramBotToken = Resolve-SecretValue -Name "TELEGRAM_BOT_TOKEN" -DotEnvValues $DotEnvValues -ExistingSecretValues $ExistingSecretValues
$TelegramChatId = Resolve-SecretValue -Name "TELEGRAM_CHAT_ID" -DotEnvValues $DotEnvValues -ExistingSecretValues $ExistingSecretValues
$AlertAiSecretConfigured = $false

if ($GeminiApiKey -and $TelegramBotToken -and $TelegramChatId) {
  $secretArgs = @(
    "-n", $Namespace,
    "create", "secret", "generic", "alert-ai-secret",
    "--from-literal=GEMINI_API_KEY=$GeminiApiKey",
    "--from-literal=TELEGRAM_BOT_TOKEN=$TelegramBotToken",
    "--from-literal=TELEGRAM_CHAT_ID=$TelegramChatId",
    "--dry-run=client", "-o", "yaml"
  )
  $secretYaml = & kubectl @secretArgs
  if ($LASTEXITCODE -ne 0) {
    throw "Could not generate alert-ai-secret."
  }

  $secretYaml | kubectl apply -f -
  if ($LASTEXITCODE -ne 0) {
    throw "Could not create or update alert-ai-secret."
  }
  $AlertAiSecretConfigured = $true
  Write-Host "Alert AI credentials loaded using environment -> .env -> existing Secret precedence."
} else {
  Write-Host "Warning: alert-ai-secret was not created. Copy .env.example to .env and fill GEMINI_API_KEY, TELEGRAM_BOT_TOKEN, and TELEGRAM_CHAT_ID."
}

Write-Host "Creating Grafana provisioning ConfigMaps..."
kubectl -n $Namespace create configmap grafana-datasources `
  --from-file=$DatasourceDir `
  --dry-run=client -o yaml | kubectl apply -f -

kubectl -n $Namespace create configmap grafana-dashboards `
  --from-file=$DashboardDir `
  --dry-run=client -o yaml | kubectl apply -f -

kubectl -n $Namespace create configmap grafana-alerting `
  --from-file=$AlertingDir `
  --dry-run=client -o yaml | kubectl apply -f -

Write-Host "Applying Kubernetes manifests..."
Get-ChildItem $K8sDir -Filter "*.yaml" |
  Sort-Object Name |
  ForEach-Object {
    kubectl apply -f $_.FullName
  }

Write-Host "Restarting monitoring workloads to reload provisioned configuration..."
kubectl -n $Namespace rollout restart deployment/prometheus deployment/grafana

if ($AlertAiSecretConfigured) {
  Write-Host "Restarting Alert AI to load the latest credentials..."
  kubectl -n $Namespace rollout restart deployment/alert-ai
}

Write-Host "Waiting for workloads..."
kubectl -n $Namespace rollout status deployment/api --timeout=180s
kubectl -n $Namespace rollout status deployment/frontend --timeout=180s
kubectl -n $Namespace rollout status deployment/prometheus --timeout=180s
kubectl -n $Namespace rollout status deployment/grafana --timeout=180s
kubectl -n $Namespace rollout status deployment/alert-ai --timeout=180s
Wait-ForTerminatingPods

Write-Host "Checking Alert AI configuration..."
$alertAiReadyResult = Invoke-KubectlText @(
  "-n", $Namespace,
  "exec", "deployment/alert-ai",
  "--", "wget", "-qO-", "http://127.0.0.1:8082/ready"
)

if ($alertAiReadyResult.ExitCode -eq 0 -and $alertAiReadyResult.Output.Count -gt 0) {
  try {
    $alertAiReady = ($alertAiReadyResult.Output -join "`n") | ConvertFrom-Json
    Write-Host "  Gemini configured:  $($alertAiReady.geminiConfigured)"
    Write-Host "  Telegram configured: $($alertAiReady.telegramConfigured)"
    if (-not $alertAiReady.geminiConfigured -or -not $alertAiReady.telegramConfigured) {
      Write-Host "Warning: Alert AI is running but Gemini/Telegram credentials are incomplete."
    }
  } catch {
    Write-Host "Warning: Alert AI /ready response could not be parsed."
  }
} else {
  Write-Host "Warning: could not query Alert AI /ready from inside the pod."
}

Write-Host "Current pods:"
kubectl -n $Namespace get pods -o wide
