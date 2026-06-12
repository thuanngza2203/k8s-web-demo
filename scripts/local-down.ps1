Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$env:HTTP_PROXY = ""
$env:HTTPS_PROXY = ""
$env:ALL_PROXY = ""

$Namespace = "cloud-web-k8s"

Write-Host "Deleting namespace $Namespace..."
kubectl delete namespace $Namespace --ignore-not-found=true
