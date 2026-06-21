param(
  [string]$Path = "$env:APPDATA\Codex\secrets\vido-sync.credential.json"
)

$required = @(
  'VIDO_SYNC_HOST',
  'VIDO_SYNC_USER',
  'VIDO_SYNC_PASSWORD',
  'VIDO_SYNC_REMOTE'
)

foreach ($name in $required) {
  if (-not [Environment]::GetEnvironmentVariable($name, 'Process')) {
    throw "Missing required environment variable: $name"
  }
}

$dir = Split-Path -Parent $Path
if (-not (Test-Path $dir)) {
  New-Item -ItemType Directory -Path $dir -Force | Out-Null
}

$payload = [ordered]@{
  host = $env:VIDO_SYNC_HOST
  user = $env:VIDO_SYNC_USER
  remote = $env:VIDO_SYNC_REMOTE
  port = if ($env:VIDO_SYNC_PORT) { [int]$env:VIDO_SYNC_PORT } else { 22 }
  password = ConvertTo-SecureString $env:VIDO_SYNC_PASSWORD -AsPlainText -Force | ConvertFrom-SecureString
  saved_at = (Get-Date).ToUniversalTime().ToString('o')
  protection = 'Windows DPAPI CurrentUser'
}

if ($env:VIDO_DB_HOST) { $payload.db_host = $env:VIDO_DB_HOST }
if ($env:VIDO_DB_USER) { $payload.db_user = $env:VIDO_DB_USER }
if ($env:VIDO_DB_ROOT_PASSWORD) {
  $payload.db_root_password = ConvertTo-SecureString $env:VIDO_DB_ROOT_PASSWORD -AsPlainText -Force | ConvertFrom-SecureString
}
if ($env:VIDO_DB_PASSWORD) {
  $payload.db_password = ConvertTo-SecureString $env:VIDO_DB_PASSWORD -AsPlainText -Force | ConvertFrom-SecureString
}

$payload | ConvertTo-Json | Set-Content -Path $Path -Encoding UTF8
Write-Host "Saved encrypted sync credential to $Path"
