param(
  [string]$CredentialPath = "$env:APPDATA\Codex\secrets\vido-sync.credential.json",
  [switch]$SkipSync,
  [switch]$KeepExisting
)

$ErrorActionPreference = 'Stop'
$root = Resolve-Path (Join-Path $PSScriptRoot '..')
Set-Location $root

if (-not $SkipSync) {
  if (-not (Test-Path $CredentialPath)) {
    throw "Missing encrypted sync credential: $CredentialPath. Run scripts/save-sync-secret.ps1 first."
  }

  $secret = Get-Content -Path $CredentialPath -Raw | ConvertFrom-Json
  $secure = $secret.password | ConvertTo-SecureString
  $plain = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  )

  try {
    $env:VIDO_SYNC_HOST = $secret.host
    $env:VIDO_SYNC_USER = if ($secret.user) { $secret.user } else { 'root' }
    $env:VIDO_SYNC_PASSWORD = $plain
    $env:VIDO_SYNC_REMOTE = if ($secret.remote) { $secret.remote } else { '/opt/vido/app' }
    $env:VIDO_SYNC_PORT = if ($secret.port) { [string]$secret.port } else { '22' }

    Write-Host '[start] Pulling latest production code before launch...'
    node scripts/sync-from-server.js --apply
  } finally {
    $env:VIDO_SYNC_PASSWORD = $null
    if ($plain) { $plain = $null }
  }
}

if (-not $KeepExisting) {
  $listeners = Get-NetTCPConnection -LocalPort 3007 -State Listen -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique
  foreach ($procId in $listeners) {
    if ($procId -and $procId -ne $PID) {
      Write-Host "[start] Stopping existing process on port 3007: $procId"
      Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
    }
  }
  Start-Sleep -Seconds 1
}

Write-Host '[start] Launching VIDO on http://localhost:3007'
node src/server.js
