# Monitor hexagon collection progress
param([switch]$loop, [int]$interval = 300)

$db = "C:\Users\cha85\Downloads\eodi.me\rust-collector\cities.db"
$pidFile = "C:\Users\cha85\Downloads\eodi.me\logs\hexagons_pid.txt"

do {
    $pid2 = [int](Get-Content $pidFile -ErrorAction SilentlyContinue)
    $proc = Get-Process -Id $pid2 -ErrorAction SilentlyContinue
    $status = if ($proc) { "Running - $([math]::Round($proc.WorkingSet64/1MB, 0))MB" } else { "STOPPED" }

    $result = python -c @"
import duckdb, datetime
try:
    con = duckdb.connect(r'$db', read_only=True)
    r = con.execute('SELECT COUNT(*), COUNT(DISTINCT parent_city_id), COUNT(CASE WHEN is_valid THEN 1 END) FROM hexagons').fetchone()
    print(f'{r[0]} hexagons / {r[1]} cities / {r[2]} valid')
    con.close()
except Exception as e:
    print(f'DB error: {e}')
"@

    Write-Host "[$((Get-Date).ToString('HH:mm:ss'))] $status | $result"

    if ($loop) { Start-Sleep $interval }
} while ($loop)
