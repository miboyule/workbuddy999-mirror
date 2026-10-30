$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path $PSScriptRoot).Path
$TestRoot = Join-Path $env:TEMP 'newapi-oneclick-local-test'
New-Item -ItemType Directory -Force -Path $TestRoot | Out-Null
$env:PUBLIC_BASE_URL = 'http://127.0.0.1:8787'
$env:CUSTOMERS_FILE = Join-Path $TestRoot 'customers.json'
$env:ADMIN_TOKEN = 'local-test-only-do-not-reuse'
$env:PORT = '8787'
$env:ONECLICK_LOCAL_FIXTURES = '1'
Push-Location $Root
try {
    go build -trimpath -ldflags='-s -w' -o (Join-Path $Root 'bin\server-local.exe') ./cmd/server
    if ($LASTEXITCODE -ne 0) { throw 'Go server build failed.' }
    go build -trimpath -tags=nethttpomithttp2 -ldflags='-s -w' -o (Join-Path $Root 'public\bin\setup-windows-amd64.exe') ./cmd/client
    if ($LASTEXITCODE -ne 0) { throw 'Windows installer build failed.' }
    python (Join-Path (Split-Path $Root -Parent) 'scripts/package-oneclick-installers.py')
    if ($LASTEXITCODE -ne 0) { throw 'Installer packaging failed.' }
    try { $health = Invoke-RestMethod -Uri 'http://127.0.0.1:8787/healthz' -TimeoutSec 1 } catch { $health = $null }
    if ($health.status -eq 'ok') {
        Write-Host 'Isolated service already running at http://127.0.0.1:8787'
        exit 0
    }
    $existing = Get-NetTCPConnection -State Listen -LocalPort 8787 -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($existing) { throw "Port 8787 is occupied by PID $($existing.OwningProcess)." }
    Start-Process -FilePath (Join-Path $Root 'bin\server-local.exe') -WorkingDirectory $Root -WindowStyle Hidden | Out-Null
    for ($i = 0; $i -lt 30; $i++) {
        try {
            $health = Invoke-RestMethod -Uri 'http://127.0.0.1:8787/healthz' -TimeoutSec 2
            if ($health.status -eq 'ok') { Write-Host 'Isolated service ready at http://127.0.0.1:8787'; exit 0 }
        } catch { Start-Sleep -Milliseconds 500 }
    }
    throw 'Isolated service failed health check.'
} finally { Pop-Location }
