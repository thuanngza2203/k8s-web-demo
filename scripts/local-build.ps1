Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")

Write-Host "Building local Kubernetes images..."

docker build `
  -t local/cloud-web-api:dev `
  (Join-Path $ProjectRoot "apps/api")

docker build `
  -t local/cloud-web-alert-ai:dev `
  (Join-Path $ProjectRoot "apps/alert-ai")

docker build `
  -t local/cloud-web-frontend:dev `
  (Join-Path $ProjectRoot "apps/frontend")

Write-Host "Images built:"
docker images "local/cloud-web-*"
