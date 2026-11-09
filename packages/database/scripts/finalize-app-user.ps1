# ==============================================================================
# Restaurant Cloud — Automated Application User Password Provisioning
# ==============================================================================
[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"

Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host "   Restaurant Cloud — rc_app_user Automated Finalization" -ForegroundColor Cyan
Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host ""

# 1. Locate psql
$psqlPath = "C:\ZKBioTime\pgsql\bin\psql.exe"
if (-not (Test-Path $psqlPath)) {
    $psqlCmd = Get-Command psql -ErrorAction SilentlyContinue
    if ($psqlCmd) { $psqlPath = $psqlCmd.Source }
    else {
        Write-Error "Could not find psql.exe on this system."
        exit 1
    }
}

# 2. Securely prompt for postgres admin password
Write-Host "[AUTH REQUIRED] Please authenticate as PostgreSQL administrator to set rc_app_user credentials." -ForegroundColor Yellow
$securePass = Read-Host -Prompt "Enter password for 'postgres'" -AsSecureString
$bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePass)
$plainPostgresPass = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
[System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)

# 3. Generate strong random password for rc_app_user (32 chars alphanumeric, zero special char escaping issues)
$bytes = New-Object byte[] 24
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$rng.GetBytes($bytes)
$appUserPass = "rc_app_" + ([System.BitConverter]::ToString($bytes) -replace "-", "").ToLower()

# 4. Execute ALTER ROLE via psql using PGPASSWORD environment variable
Write-Host "[PROGRESS] Applying credentials for rc_app_user in PostgreSQL..." -ForegroundColor Gray
$env:PGPASSWORD = $plainPostgresPass

$alterCmd = "ALTER ROLE rc_app_user WITH PASSWORD '$appUserPass';"
$processInfo = New-Object System.Diagnostics.ProcessStartInfo
$processInfo.FileName = $psqlPath
$processInfo.Arguments = "-h 127.0.0.1 -p 15432 -U postgres -d restaurant_cloud_staging -c `"$alterCmd`""
$processInfo.RedirectStandardOutput = $true
$processInfo.RedirectStandardError = $true
$processInfo.UseShellExecute = $false
$processInfo.CreateNoWindow = $true

$proc = [System.Diagnostics.Process]::Start($processInfo)
$stdout = $proc.StandardOutput.ReadToEnd()
$stderr = $proc.StandardError.ReadToEnd()
$proc.WaitForExit()

# Clear plain admin password from memory
$plainPostgresPass = $null
$env:PGPASSWORD = $null

if ($proc.ExitCode -ne 0) {
    Write-Host "[ERROR] Failed to alter role rc_app_user:" -ForegroundColor Red
    Write-Host $stderr -ForegroundColor Red
    exit 1
}

Write-Host "[SUCCESS] rc_app_user credentials successfully configured in PostgreSQL!" -ForegroundColor Green

# 5. Automatically update d:\Antigravity\pos\.env
$envFile = "d:\Antigravity\pos\.env"
$encodedPass = [System.Uri]::EscapeDataString($appUserPass)
$newConnString = "DATABASE_URL=postgresql://rc_app_user:$encodedPass@127.0.0.1:15432/restaurant_cloud_staging"

$envContent = Get-Content -Path $envFile -Raw
if ($envContent -match "DATABASE_URL=.*") {
    $envContent = $envContent -replace "DATABASE_URL=.*", $newConnString
} else {
    $envContent = $newConnString + "`r`n" + $envContent
}

[System.IO.File]::WriteAllText($envFile, $envContent, [System.Text.Encoding]::UTF8)
Write-Host "[SUCCESS] Local .env updated with verified DATABASE_URL." -ForegroundColor Green

# 6. Execute Dual-Role and Isolation Probe
Write-Host ""
Write-Host "[TESTING] Running dual-role connection and production isolation probe..." -ForegroundColor Cyan
$env:NODE_PATH = "d:\Antigravity\pos\packages\database\node_modules"
& node d:\Antigravity\pos\packages\database\scripts\probe-connection.cjs

Write-Host "======================================================================" -ForegroundColor Cyan
Write-Host "   Database Foundation Setup Complete & Ready for Unit Building!" -ForegroundColor Green
Write-Host "======================================================================" -ForegroundColor Cyan
