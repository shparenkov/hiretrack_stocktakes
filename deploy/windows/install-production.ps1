#Requires -RunAsAdministrator

[CmdletBinding()]
param(
  [string]$InstallRoot = 'C:\Services',
  [string]$RepoUrl = 'https://github.com/shparenkov/hiretrack_stocktakes.git',
  [string]$Branch = 'master',
  [int]$Port = 3001
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$serviceId = 'HireTrackStocktakes'
$appDirectory = Join-Path $InstallRoot 'hiretrack_stocktakes'
$wrapperPath = Join-Path $appDirectory "$serviceId.exe"
$wrapperConfigPath = Join-Path $appDirectory "$serviceId.xml"
$healthUrl = "http://127.0.0.1:$Port/health"
$firewallRuleName = 'HireTrack Stocktakes (Tailscale)'

function Write-Step([string]$Message) {
  Write-Host "`n==> $Message" -ForegroundColor Cyan
}

function Refresh-Path {
  $machinePath = [Environment]::GetEnvironmentVariable('Path', 'Machine')
  $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
  $env:Path = "$machinePath;$userPath"
}

function Install-NodeLts {
  if (Get-Command node -ErrorAction SilentlyContinue) {
    return
  }

  Write-Step 'Installing the current Node.js LTS release'
  $releases = Invoke-RestMethod -Uri 'https://nodejs.org/dist/index.json'
  $release = $releases |
    Where-Object { $_.lts -and $_.files -contains 'win-x64-msi' } |
    Select-Object -First 1
  if (-not $release) {
    throw 'Could not find a Windows x64 Node.js LTS release.'
  }

  $msiPath = Join-Path $env:TEMP "node-$($release.version)-x64.msi"
  $msiUrl = "https://nodejs.org/dist/$($release.version)/node-$($release.version)-x64.msi"
  Invoke-WebRequest -UseBasicParsing -Uri $msiUrl -OutFile $msiPath
  $process = Start-Process -FilePath msiexec.exe -ArgumentList '/i', $msiPath, '/qn', '/norestart' -Wait -PassThru
  Remove-Item -LiteralPath $msiPath -Force -ErrorAction SilentlyContinue
  if ($process.ExitCode -ne 0) {
    throw "Node.js MSI installation failed with exit code $($process.ExitCode)."
  }
  Refresh-Path
}

function Install-WinSw {
  if (Test-Path -LiteralPath $wrapperPath) {
    return
  }

  Write-Step 'Downloading Windows Service Wrapper'
  $headers = @{ 'User-Agent' = 'HireTrack-Stocktakes-Installer' }
  $release = Invoke-RestMethod -Headers $headers -Uri 'https://api.github.com/repos/winsw/winsw/releases/latest'
  $asset = $release.assets | Where-Object { $_.name -eq 'WinSW-x64.exe' } | Select-Object -First 1
  if (-not $asset) {
    $asset = $release.assets | Where-Object { $_.name -eq 'WinSW-net461.exe' } | Select-Object -First 1
  }
  if (-not $asset) {
    throw 'No compatible WinSW executable was found in the latest release.'
  }
  Invoke-WebRequest -UseBasicParsing -Headers $headers -Uri $asset.browser_download_url -OutFile $wrapperPath
}

function Write-ServiceConfig([string]$NodePath) {
  $escapedNodePath = [Security.SecurityElement]::Escape($NodePath)
  $escapedAppDirectory = [Security.SecurityElement]::Escape($appDirectory)
  $xml = @"
<service>
  <id>$serviceId</id>
  <name>HireTrack Stocktakes</name>
  <description>HireTrack NX stock-check history and PDF reporting service.</description>
  <executable>$escapedNodePath</executable>
  <arguments>dist\backend\src\index.js</arguments>
  <workingdirectory>$escapedAppDirectory</workingdirectory>
  <startmode>Automatic</startmode>
  <delayedAutoStart>true</delayedAutoStart>
  <stoptimeout>20 sec</stoptimeout>
  <onfailure action="restart" delay="10 sec" />
  <onfailure action="restart" delay="30 sec" />
  <resetfailure>1 hour</resetfailure>
  <env name="PORT" value="$Port" />
  <env name="HOST" value="0.0.0.0" />
  <env name="TICKETS_STORE_MODE" value="memory" />
  <logpath>%BASE%\logs</logpath>
  <log mode="roll-by-size">
    <sizeThreshold>10240</sizeThreshold>
    <keepFiles>8</keepFiles>
  </log>
</service>
"@
  Set-Content -LiteralPath $wrapperConfigPath -Value $xml -Encoding UTF8
}

Write-Step 'Checking prerequisites'
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  throw 'Git is required but was not found.'
}
Install-NodeLts
if (-not (Get-Command node -ErrorAction SilentlyContinue) -or -not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
  throw 'Node.js or npm was not found after installation.'
}

Write-Step 'Preparing application directory'
New-Item -ItemType Directory -Path $InstallRoot -Force | Out-Null
if (Test-Path -LiteralPath (Join-Path $appDirectory '.git')) {
  Push-Location $appDirectory
  try {
    git config core.autocrlf false
    git restore --worktree -- dist package-lock.json
    git fetch origin $Branch
    git checkout $Branch
    git pull --ff-only origin $Branch
  } finally {
    Pop-Location
  }
} elseif (Test-Path -LiteralPath $appDirectory) {
  if ((Get-ChildItem -LiteralPath $appDirectory -Force | Measure-Object).Count -gt 0) {
    throw "$appDirectory exists and is not an empty Git checkout."
  }
  git clone --branch $Branch --single-branch $RepoUrl $appDirectory
} else {
  git clone --branch $Branch --single-branch $RepoUrl $appDirectory
}

git -C $appDirectory config core.autocrlf false

Write-Step 'Installing dependencies and building application'
Push-Location $appDirectory
try {
  & npm.cmd ci
  if ($LASTEXITCODE -ne 0) { throw 'npm ci failed.' }
  & npm.cmd run prisma:generate
  if ($LASTEXITCODE -ne 0) { throw 'Prisma Client generation failed.' }
  & npm.cmd run build
  if ($LASTEXITCODE -ne 0) { throw 'npm run build failed.' }
} finally {
  Pop-Location
}

Install-WinSw
$nodePath = (Get-Command node -ErrorAction Stop).Source
Write-ServiceConfig -NodePath $nodePath
New-Item -ItemType Directory -Path (Join-Path $appDirectory 'logs') -Force | Out-Null

Write-Step 'Allowing the application port from Tailscale only'
$firewallRule = Get-NetFirewallRule -DisplayName $firewallRuleName -ErrorAction SilentlyContinue
if (-not $firewallRule) {
  New-NetFirewallRule `
    -DisplayName $firewallRuleName `
    -Direction Inbound `
    -Action Allow `
    -Protocol TCP `
    -LocalPort $Port `
    -RemoteAddress '100.64.0.0/10' `
    -Profile Any | Out-Null
}

Write-Step 'Installing and starting Windows service'
$existingService = Get-Service -Name $serviceId -ErrorAction SilentlyContinue
if ($existingService) {
  & $wrapperPath restart
} else {
  & $wrapperPath install
  if ($LASTEXITCODE -ne 0) { throw 'Service installation failed.' }
  & $wrapperPath start
}
if ($LASTEXITCODE -ne 0) { throw 'Service start failed.' }

Write-Step 'Checking service health'
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

$configPath = Join-Path $InstallRoot 'hiretrack.config.json'
Write-Host "`nProduction service is running at http://$env:COMPUTERNAME`:$Port/bitrix/tickets/stocktake-history/" -ForegroundColor Green
if (-not (Test-Path -LiteralPath $configPath)) {
  Write-Warning "Copy hiretrack.config.json to $configPath before loading Stock Check data."
}
