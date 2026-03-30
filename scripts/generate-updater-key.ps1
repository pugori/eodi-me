#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Generate a Tauri updater signing key pair for eodi.me release signing.

.DESCRIPTION
    Generates a Minisign key pair used to sign Tauri desktop app updates.
    The private key signs each release artifact.
    The public key (printed at the end) must be set in tauri.conf.json.

    Steps after running this script:
      1. Copy the printed pubkey into tauri.conf.json → tauri.updater.pubkey
      2. Set tauri.updater.active = true in tauri.conf.json
      3. Add the private key to your CI environment (TAURI_PRIVATE_KEY secret)
      4. Set TAURI_KEY_PASSWORD in CI (the password you enter below)
      5. Build with: npm run tauri build
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$keyDir = Join-Path $HOME ".tauri"
$keyPath = Join-Path $keyDir "eodi.me.key"

if (-not (Test-Path $keyDir)) {
    New-Item -ItemType Directory -Path $keyDir | Out-Null
}

Write-Host ""
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host "  eodi.me Tauri Updater Key Generator" -ForegroundColor Cyan
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host ""

if (Test-Path $keyPath) {
    Write-Warning "Key already exists at: $keyPath"
    $overwrite = Read-Host "Overwrite? (y/N)"
    if ($overwrite -ne 'y') {
        Write-Host "Aborted." -ForegroundColor Yellow
        exit 0
    }
}

# Check for tauri CLI
$tauriCmd = Get-Command "tauri" -ErrorAction SilentlyContinue
if (-not $tauriCmd) {
    # Try npm exec
    Write-Host "tauri CLI not found globally, trying npm exec..." -ForegroundColor Yellow
    Push-Location (Join-Path $PSScriptRoot "..\tauri-shell")
    try {
        npm exec -- tauri signer generate -w $keyPath
    } finally {
        Pop-Location
    }
} else {
    tauri signer generate -w $keyPath
}

Write-Host ""
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Green
Write-Host "  Key generated at: $keyPath" -ForegroundColor Green
Write-Host "  Public key file:  $keyPath.pub" -ForegroundColor Green
Write-Host ""
Write-Host "  Next steps:" -ForegroundColor White
Write-Host "  1. Copy the pubkey above into tauri.conf.json:" -ForegroundColor White
Write-Host '       "updater": { "active": true, "pubkey": "<paste here>", ... }' -ForegroundColor Gray
Write-Host "  2. Add TAURI_PRIVATE_KEY (contents of $keyPath) to CI secrets" -ForegroundColor White
Write-Host "  3. Add TAURI_KEY_PASSWORD to CI secrets" -ForegroundColor White
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Green
Write-Host ""
