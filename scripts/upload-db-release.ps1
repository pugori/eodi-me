#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Upload eodi.me database files to a GitHub Release asset.

.DESCRIPTION
    Uploads the three DB files from the output/ directory to the specified
    GitHub Release tag as downloadable assets.
    Requires the GitHub CLI (gh) to be installed and authenticated.

    DB files uploaded:
      - hexagons.edbh       (~161 MB) — hex vector database
      - hexagons.edbh.adm   (~34 MB)  — admin boundary database
      - cities.edb          (~5 MB)   — cities index

.PARAMETER Tag
    The release tag to upload to (e.g. v1.0.0). Must already exist.

.PARAMETER OutputDir
    Directory containing the built DB files. Defaults to ./output.

.EXAMPLE
    .\scripts\upload-db-release.ps1 -Tag v1.0.0
#>

param(
    [Parameter(Mandatory = $true)]
    [string]$Tag,

    [string]$OutputDir = (Join-Path $PSScriptRoot "..\output")
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$files = @(
    'hexagons.edbh',
    'hexagons.edbh.adm',
    'cities.edb'
)

Write-Host ""
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host "  eodi.me DB Release Uploader" -ForegroundColor Cyan
Write-Host "  Tag: $Tag" -ForegroundColor Cyan
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Cyan
Write-Host ""

# Verify gh CLI is available
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
    Write-Error "GitHub CLI (gh) is not installed. Install from https://cli.github.com/ and run 'gh auth login'."
    exit 1
}

# Verify all DB files exist
$OutputDir = Resolve-Path $OutputDir
foreach ($f in $files) {
    $path = Join-Path $OutputDir $f
    if (-not (Test-Path $path)) {
        Write-Error "DB file not found: $path`nRun the rust-collector pipeline first: cd rust-collector && cargo run --release -- build-full"
        exit 1
    }
    $size = (Get-Item $path).Length
    $sizeMb = [math]::Round($size / 1MB, 1)
    Write-Host "  ✓ $f  ($sizeMb MB)" -ForegroundColor Green
}
Write-Host ""

# Compute SHA-256 hashes and write manifest
$manifest = @{}
foreach ($f in $files) {
    $path = Join-Path $OutputDir $f
    $hash = (Get-FileHash -Path $path -Algorithm SHA256).Hash.ToLower()
    $size = (Get-Item $path).Length
    $manifest[$f] = @{ sha256 = $hash; size = $size }
    Write-Host "  SHA256[$f] = $hash" -ForegroundColor DarkGray
}

$manifestPath = Join-Path $OutputDir "db-manifest.json"
$manifest | ConvertTo-Json -Depth 3 | Set-Content $manifestPath -Encoding UTF8
Write-Host ""
Write-Host "  Manifest written: db-manifest.json" -ForegroundColor DarkGray
Write-Host ""

# Upload all files to the release
$uploadFiles = $files + @("db-manifest.json")
foreach ($f in $uploadFiles) {
    $path = Join-Path $OutputDir $f
    Write-Host "Uploading $f..." -ForegroundColor Yellow
    gh release upload $Tag $path --clobber --repo eodi-me/app
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Upload failed for $f"
        exit 1
    }
    Write-Host "  ✓ Uploaded $f" -ForegroundColor Green
}

Write-Host ""
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Green
Write-Host "  All DB files uploaded to release $Tag" -ForegroundColor Green
Write-Host "  Users will download them on first launch." -ForegroundColor Green
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Green
Write-Host ""
