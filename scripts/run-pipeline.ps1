Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Host.UI.RawUI.WindowTitle = "eodi.me - Data Collection Pipeline"
$outputDir = "C:\Users\cha85\Downloads\eodi.me\output"
$logDir = "C:\Users\cha85\Downloads\eodi.me\logs"
$collector = "$outputDir\eodi-collector.exe"
$db = "$outputDir\cities.db"

function Write-Step($msg) {
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "  $msg" -ForegroundColor Cyan
    Write-Host "  $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" -ForegroundColor DarkCyan
    Write-Host "========================================" -ForegroundColor Cyan
}

Write-Step "Stage 2: collect-poi (RESUME from India 70%)"
& $collector --database $db --no-pause collect-poi --concurrency 6 --climate-year 2024
if ($LASTEXITCODE -ne 0) { Write-Host "Stage 2 FAILED (exit $LASTEXITCODE)" -ForegroundColor Red; Read-Host "Press Enter"; exit 1 }

Write-Step "Stats after Stage 2"
& $collector --database $db --no-pause stats

Write-Step "Stage 3: build-vdb -> cities.edb"
& $collector --database $db --no-pause build-vdb --output "$outputDir\cities.edb"
if ($LASTEXITCODE -ne 0) { Write-Host "Stage 3 FAILED" -ForegroundColor Red; Read-Host "Press Enter"; exit 1 }

Write-Step "Stage 4: download-boundaries"
& $collector --database $db --no-pause download-boundaries --overpass-api "https://overpass.kumi.systems/api/interpreter"
if ($LASTEXITCODE -ne 0) { Write-Host "Stage 4 FAILED" -ForegroundColor Red; Read-Host "Press Enter"; exit 1 }

Write-Step "Stage 4b: collect-hexagons"
& $collector --database $db --no-pause collect-hexagons --overpass-api "https://overpass.kumi.systems/api/interpreter" --concurrency 6 --resume
if ($LASTEXITCODE -ne 0) { Write-Host "Stage 4b FAILED" -ForegroundColor Red; Read-Host "Press Enter"; exit 1 }

Write-Step "Stage 5: build-hex-vdb -> hexagons.edbh"
& $collector --database $db --no-pause build-hex-vdb --output "$outputDir\hexagons.edbh"
if ($LASTEXITCODE -ne 0) { Write-Host "Stage 5 FAILED" -ForegroundColor Red; Read-Host "Press Enter"; exit 1 }

Write-Step "ALL STAGES COMPLETE!"
Write-Host "hexagons.edbh ready. Restart engine to apply." -ForegroundColor Green
Read-Host "Press Enter to close"
