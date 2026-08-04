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
$wrapperConfigPath = Join-Path $appDirectory "$serviceId.xml"
$python = Get-Command python.exe -ErrorAction Stop

& $python.Source -c 'import pyodbc'
if ($LASTEXITCODE -ne 0) { throw 'The 32-bit Python pyodbc package is required.' }

if (-not (Test-Path -LiteralPath (Join-Path $appDirectory '.git'))) {
  throw "$appDirectory is not a Git checkout. Run install-production.ps1 first."
}
if (-not (Test-Path -LiteralPath $wrapperPath)) {
  throw "$wrapperPath was not found. Run install-production.ps1 first."
}

Write-Host "Updating HireTrack Stocktakes from $Branch..." -ForegroundColor Cyan
Push-Location $appDirectory
try {
  git config core.autocrlf false
  git restore --worktree -- dist package-lock.json
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
    git diff --ignore-space-at-eol --exit-code -- dist
    if ($LASTEXITCODE -ne 0) { throw 'Generated dist does not match the committed build.' }
    git restore --worktree -- dist package-lock.json
    git add -- dist
    git diff --cached --exit-code
    if ($LASTEXITCODE -ne 0) { throw 'Generated dist changed the Git index unexpectedly.' }

    [xml]$serviceConfig = Get-Content -LiteralPath $wrapperConfigPath
    $serviceEnvironment = @{
      HIRETRACK_PYTHON = $python.Source
      HIRETRACK_ODBC_DSN = 'HireTrack DSN'
      HIRETRACK_ODBC_TIMEOUT_MS = '90000'
      HIRETRACK_ODBC_QUERY_TIMEOUT = '60'
      STOCKTAKE_ODBC_CACHE_MS = '30000'
    }
    foreach ($entry in $serviceEnvironment.GetEnumerator()) {
      $node = $serviceConfig.service.env | Where-Object { $_.name -eq $entry.Key } | Select-Object -First 1
      if (-not $node) {
        $node = $serviceConfig.CreateElement('env')
        $node.SetAttribute('name', $entry.Key)
        [void]$serviceConfig.service.AppendChild($node)
      }
      $node.SetAttribute('value', $entry.Value)
    }
    $serviceConfig.Save($wrapperConfigPath)
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
