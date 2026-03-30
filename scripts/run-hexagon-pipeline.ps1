# Auto-run hexagon pipeline after boundaries complete
# Usage: .\scripts\run-hexagon-pipeline.ps1

$root = "C:\Users\cha85\Downloads\eodi.me"
$collector = "$root\rust-collector\target\debug\eodi-collector.exe"
$logDir = "$root\logs"
$overpassMirror = "https://maps.mail.ru/osm/tools/overpass/api/interpreter"

function Get-BoundaryStatus {
    $pidFile = "$logDir\boundaries_pid.txt"
    if (Test-Path $pidFile) {
        $pid2 = [int](Get-Content $pidFile)
        $proc = Get-Process -Id $pid2 -ErrorAction SilentlyContinue
        return $proc -ne $null
    }
    return $false
}

Write-Host "=== EODI Hexagon Pipeline Monitor ==="
Write-Host "Waiting for download-boundaries to complete..."

# Wait for boundaries to finish
$waited = 0
while (Get-BoundaryStatus) {
    Start-Sleep -Seconds 60
    $waited += 60
    $lines = Get-Content "$logDir\boundaries_stdout.log" | Where-Object { $_ -match "saved" } | Select-Object -Last 1
    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Still running... last: $lines"
}

Write-Host "Boundaries download COMPLETED at $(Get-Date -Format 'HH:mm:ss')"
Write-Host ""

# Check boundary count
& python -c "import duckdb; con=duckdb.connect('$root\rust-collector\cities.db',read_only=True); r=con.execute('SELECT COUNT(*), COUNT(DISTINCT country_code) FROM boundaries').fetchone(); print(f'Boundaries: {r[0]} polygons, {r[1]} countries'); con.close()"

Write-Host ""
Write-Host "=== Starting collect-hexagons ==="

$proc = Start-Process -FilePath $collector `
    -WorkingDirectory "$root\rust-collector" `
    -ArgumentList "--no-pause collect-hexagons --resume --concurrency 6 --overpass-api $overpassMirror" `
    -RedirectStandardOutput "$logDir\hexagons_stdout.log" `
    -RedirectStandardError "$logDir\hexagons_stderr.log" `
    -PassThru
Write-Host "Started collect-hexagons PID: $($proc.Id)"
$proc.Id | Out-File "$logDir\hexagons_pid.txt"

Write-Host "Monitoring collect-hexagons..."
while ($proc -and !$proc.HasExited) {
    Start-Sleep -Seconds 120
    $lines = Get-Content "$logDir\hexagons_stdout.log" -Tail 3 -ErrorAction SilentlyContinue
    Write-Host "[$(Get-Date -Format 'HH:mm:ss')] $($lines -join ' | ')"
}

Write-Host ""
Write-Host "=== collect-hexagons COMPLETED ==="
Write-Host ""

# Check hexagon count
& python -c "import duckdb; con=duckdb.connect('$root\rust-collector\cities.db',read_only=True); r=con.execute('SELECT COUNT(*), COUNT(CASE WHEN is_valid THEN 1 END) FROM hexagons').fetchone(); print(f'Hexagons: {r[0]} total, {r[1]} valid'); con.close()"

Write-Host ""
Write-Host "=== Starting build-vdb ==="
Set-Location "$root\rust-collector"
& $collector --no-pause build-vdb --output "..\output\cities.edb"

Write-Host ""
Write-Host "=== Starting build-hex-vdb ==="
& $collector --no-pause build-hex-vdb --output "..\output\hexagons.edbh"

Write-Host ""
Write-Host "=== Pipeline COMPLETE ==="
