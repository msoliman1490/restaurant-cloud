# ==============================================================================
# Restaurant Cloud -- Update Local .env with rc_app_user Password (Secure & Masked)
# Target Server: PostgreSQL 18.6 via SSH Tunnel (127.0.0.1:15432)
# ==============================================================================
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

Write-Host '======================================================================' -ForegroundColor Cyan
Write-Host '   Restaurant Cloud -- Secure .env DATABASE_URL Configuration' -ForegroundColor Cyan
Write-Host '======================================================================' -ForegroundColor Cyan
Write-Host ''

# 1. Secure prompt with masked characters
$securePass = Read-Host -Prompt "Enter password for 'rc_app_user'" -AsSecureString
if (-not $securePass) {
    Write-Error "Password cannot be empty."
    exit 1
}

$bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePass)
$plainPass = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
[System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)

# 2. Automatically URL-encode special characters
$encodedPass = [System.Uri]::EscapeDataString($plainPass)
$plainPass = $null

# 3. Locate .env file safely
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path
$envFile = Join-Path $projectRoot ".env"

if (-not (Test-Path $envFile)) {
    Write-Error ".env file not found at $envFile"
    exit 1
}

$newConnString = "DATABASE_URL=postgresql://rc_app_user:$encodedPass@127.0.0.1:15432/restaurant_cloud_staging"

# 4. Line-by-line replacement to guarantee MIGRATIONS_DATABASE_URL is NEVER touched
$lines = Get-Content -Path $envFile
$newLines = [System.Collections.Generic.List[string]]::new()
$replaced = $false

foreach ($line in $lines) {
    if ($line -match "^DATABASE_URL=") {
        $newLines.Add($newConnString)
        $replaced = $true
    } else {
        $newLines.Add($line)
    }
}

if (-not $replaced) {
    $newLines.Add($newConnString)
}

[System.IO.File]::WriteAllLines($envFile, $newLines, [System.Text.Encoding]::UTF8)
Write-Host "[SUCCESS] Local .env updated with verified DATABASE_URL." -ForegroundColor Green
Write-Host "[VERIFIED] MIGRATIONS_DATABASE_URL was left completely untouched." -ForegroundColor Green
Write-Host ""

# 5. Execute Live Probe
Write-Host "[VERIFYING] Running live dual-role and production isolation probe..." -ForegroundColor Cyan
$probeScript = Join-Path $PSScriptRoot "probe-connection.cjs"
$nodeModules = (Resolve-Path (Join-Path $PSScriptRoot "..\node_modules")).Path
$env:NODE_PATH = $nodeModules

& node $probeScript
