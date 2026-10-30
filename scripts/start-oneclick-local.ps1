$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path $PSScriptRoot -Parent
$TestRoot = Join-Path $env:TEMP 'workbuddy-oneclick-integrated'
New-Item -ItemType Directory -Force -Path $TestRoot | Out-Null
try {
    $page = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:8787/setup/' -TimeoutSec 2
    if ($page.StatusCode -eq 200 -and $page.Content.Contains('id="code"')) {
        Write-Host 'Integrated service already available: http://127.0.0.1:8787/setup/'
        exit 0
    }
} catch {}
Push-Location (Join-Path $ProjectRoot 'oneclick')
try {
    go build -trimpath -ldflags='-s -w' -o bin/server.exe ./cmd/server
    if ($LASTEXITCODE -ne 0) { throw 'Server build failed.' }
    go build -trimpath -tags=nethttpomithttp2 -ldflags='-s -w' -o public/bin/setup-windows-amd64.exe ./cmd/client
    if ($LASTEXITCODE -ne 0) { throw 'Installer build failed.' }
    python (Join-Path $ProjectRoot 'scripts/package-oneclick-installers.py')
    if ($LASTEXITCODE -ne 0) { throw 'Installer packaging failed.' }
} finally { Pop-Location }
$env:ONECLICK_LOCAL_ENABLED = '1'
$env:ONECLICK_LOCAL_FIXTURES = '0'
$env:ONECLICK_CUSTOMERS_FILE = Join-Path $TestRoot 'customers.json'
$env:BIND_HOST = '127.0.0.1'
$env:PORT = '8787'
$service = Start-Process -FilePath (Get-Command node).Source -ArgumentList 'server.mjs' -WorkingDirectory $ProjectRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $TestRoot 'server.log') -RedirectStandardError (Join-Path $TestRoot 'server-error.log')
for ($i = 0; $i -lt 40; $i++) {
    if ($service.HasExited) { throw "Service failed. Check $TestRoot/server-error.log; local PostgreSQL and NewAPI must be running." }
    try {
        $page = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:8787/setup/' -TimeoutSec 1
        if ($page.StatusCode -eq 200 -and $page.Content.Contains('id="code"')) {
            Write-Host 'Integrated service ready: http://127.0.0.1:8787/setup/'
            exit 0
        }
    } catch {}
    Start-Sleep -Milliseconds 500
}
throw "Service not ready. Check $TestRoot/server-error.log."
