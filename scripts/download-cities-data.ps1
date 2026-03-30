#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Download GeoNames cities15000.txt dataset

.DESCRIPTION
    Downloads and extracts cities with population > 15,000 from GeoNames.
    License: CC BY 4.0
    Source: https://www.geonames.org/
#>

$ErrorActionPreference = "Stop"

# URLs
$CITIES_URL = "https://download.geonames.org/export/dump/cities15000.zip"
$DATA_DIR = "data"
$ZIP_FILE = "$DATA_DIR/cities15000.zip"
$TXT_FILE = "$DATA_DIR/cities15000.txt"

Write-Host ""
Write-Host "================================================" -ForegroundColor Cyan
Write-Host " GeoNames Cities Dataset Downloader" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "License: CC BY 4.0" -ForegroundColor Yellow
Write-Host "Source:  https://www.geonames.org/" -ForegroundColor Yellow
Write-Host ""

# Create data directory
if (-not (Test-Path $DATA_DIR)) {
    Write-Host "📁 Creating data directory..." -ForegroundColor Green
    New-Item -ItemType Directory -Path $DATA_DIR | Out-Null
}

# Check if already exists
if (Test-Path $TXT_FILE) {
    $fileSize = (Get-Item $TXT_FILE).Length / 1MB
    Write-Host "⚠️  cities15000.txt already exists ($([math]::Round($fileSize, 2)) MB)" -ForegroundColor Yellow
    $overwrite = Read-Host "Download again? (y/n)"
    if ($overwrite -ne "y") {
        Write-Host "✓ Using existing file" -ForegroundColor Green
        exit 0
    }
}

# Download
Write-Host ""
Write-Host "📥 Downloading cities15000.zip..." -ForegroundColor Cyan
Write-Host "   URL: $CITIES_URL" -ForegroundColor Gray
Write-Host ""

try {
    # Download with progress
    $ProgressPreference = 'SilentlyContinue'
    Invoke-WebRequest -Uri $CITIES_URL -OutFile $ZIP_FILE -UseBasicParsing
    $ProgressPreference = 'Continue'

    $zipSize = (Get-Item $ZIP_FILE).Length / 1MB
    Write-Host "✓ Downloaded: $([math]::Round($zipSize, 2)) MB" -ForegroundColor Green
}
catch {
    Write-Host "❌ Download failed: $_" -ForegroundColor Red
    exit 1
}

# Extract
Write-Host ""
Write-Host "📦 Extracting cities15000.txt..." -ForegroundColor Cyan

try {
    Expand-Archive -Path $ZIP_FILE -DestinationPath $DATA_DIR -Force

    if (Test-Path $TXT_FILE) {
        $txtSize = (Get-Item $TXT_FILE).Length / 1MB
        Write-Host "✓ Extracted: $([math]::Round($txtSize, 2)) MB" -ForegroundColor Green
    }
    else {
        throw "cities15000.txt not found in archive"
    }
}
catch {
    Write-Host "❌ Extraction failed: $_" -ForegroundColor Red
    exit 1
}

# Cleanup
Write-Host ""
Write-Host "🧹 Cleaning up..." -ForegroundColor Cyan
Remove-Item $ZIP_FILE -Force -ErrorAction SilentlyContinue
Write-Host "✓ Removed temporary files" -ForegroundColor Green

# Verify
Write-Host ""
Write-Host "✅ Verification" -ForegroundColor Cyan
$lines = (Get-Content $TXT_FILE | Measure-Object -Line).Lines
Write-Host "   File:   $TXT_FILE" -ForegroundColor Gray
Write-Host "   Size:   $([math]::Round((Get-Item $TXT_FILE).Length / 1MB, 2)) MB" -ForegroundColor Gray
Write-Host "   Cities: $lines" -ForegroundColor Gray

Write-Host ""
Write-Host "🎉 Download complete!" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "  1. Double-click eodi-collector-run.bat" -ForegroundColor White
Write-Host "  2. Or run: .\eodi-collector.exe build-full -f $TXT_FILE -l 1000" -ForegroundColor White
Write-Host ""
