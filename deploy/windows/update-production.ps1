#Requires -RunAsAdministrator

[CmdletBinding()]
param(
  [string]$InstallRoot = 'C:\Services',
  [string]$Branch = 'master',
  [int]$Port = 3001
)

$ErrorActionPreference = 'Stop'
$serviceId = 'HireTrackStocktakes'
$appDirectory = Join-Path $InstallRoot 'hiretrack_stocktakes'
$wrapperPath = Join-Path $appDirectory "$serviceId.exe"
$healthUrl = "http://127.0.0.1:$Port/health"

if (-not (Test-Path -LiteralPath (Join-Path $appDirectory '.git'))) {
  throw "$appDirectory is not a Git checkout. Run install-production.ps1 first."
}
if (-not (Test-Path -LiteralPath $wrapperPath)) {
  throw "$wrapperPath was not found. Run install-production.ps1 first."
}

Write-Host "Updating HireTrack Stocktakes from $Branch..." -ForegroundColor Cyan
Push-Location $appDirectory
try {
  git fetch origin $Branch
  git checkout $Branch
  git pull --ff-only origin $Branch

  & $wrapperPath stop
  try {
    & npm.cmd ci
    if ($LASTEXITCODE -ne 0) { throw 'npm ci failed.' }
    & npm.cmd run prisma:generate
    if ($LASTEXITCODE -ne 0) { throw 'Prisma Client generation failed.' }
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw 'npm run build failed.' }
    & npm.cmd prune --omit=dev
    if ($LASTEXITCODE -ne 0) { throw 'npm prune failed.' }
  } catch {
    & $wrapperPath start
    throw
  }
  & $wrapperPath start
  if ($LASTEXITCODE -ne 0) { throw 'Service start failed.' }
} finally {
  Pop-Location
}

$healthy = $false
for ($attempt = 1; $attempt -le 20; $attempt += 1) {
  Start-Sleep -Seconds 1
  try {
    $health = Invoke-RestMethod -UseBasicParsing -Uri $healthUrl -TimeoutSec 3
    if ($health.ok) {
      $healthy = $true
      break
    }
  } catch {
    # Service may still be starting.
  }
}
if (-not $healthy) {
  throw "Service did not become healthy at $healthUrl. Check $appDirectory\logs."
}

Write-Host "HireTrack Stocktakes is healthy at $healthUrl" -ForegroundColor Green
