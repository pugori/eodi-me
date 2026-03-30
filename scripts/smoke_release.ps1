param(
  [string]$EnginePath = ".\engine-server\target\release\eodi-engine.exe",
  [string]$HexDbPath = ".\output\hexagons.edbh",
  [string]$Token = "smoke_token_local"
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $EnginePath)) {
  throw "Engine binary not found: $EnginePath"
}

if (-not (Test-Path $HexDbPath)) {
  throw "Hex DB not found: $HexDbPath"
}

$outFile = Join-Path $PSScriptRoot "..\logs\engine_smoke_stdout.txt"
$errFile = Join-Path $PSScriptRoot "..\logs\engine_smoke_stderr.txt"

$proc = Start-Process `
  -FilePath $EnginePath `
  -ArgumentList @($HexDbPath, $Token) `
  -RedirectStandardOutput $outFile `
  -RedirectStandardError $errFile `
  -PassThru

try {
  $port = $null
  for ($i = 0; $i -lt 80; $i++) {
    if (Test-Path $outFile) {
      $line = Get-Content $outFile -ErrorAction SilentlyContinue |
        Select-String "ENGINE_PORT=" |
        Select-Object -Last 1
      if ($line) {
        $port = ($line.ToString().Split('=')[1]).Trim()
        break
      }
    }
    Start-Sleep -Milliseconds 250
  }

  if (-not $port) {
    $stdout = if (Test-Path $outFile) { Get-Content $outFile | Out-String } else { "<none>" }
    $stderr = if (Test-Path $errFile) { Get-Content $errFile | Out-String } else { "<none>" }
    throw "Failed to detect engine port.`nSTDOUT:`n$stdout`nSTDERR:`n$stderr"
  }

  $base = "http://127.0.0.1:$port"
  $authHeaders = @{ Authorization = "Bearer $Token" }

  $health = Invoke-RestMethod "$base/health" -Method Get -TimeoutSec 5
  if ($health.status -ne "ok") {
    throw "Health check failed"
  }

  $stats = Invoke-RestMethod "$base/stats" -Headers $authHeaders -Method Get -TimeoutSec 5
  if (-not $stats.total_hexagons -or $stats.total_hexagons -lt 1) {
    throw "Stats check failed"
  }

  $search = Invoke-RestMethod "$base/hex/search?q=seoul&limit=1" -Headers $authHeaders -Method Get -TimeoutSec 5
  if (-not $search.hexagons -or $search.hexagons.Count -lt 1) {
    throw "Search check failed"
  }

  $h3 = $search.hexagons[0].h3_index
  $match = Invoke-RestMethod "$base/hex/match?h3_index=$h3&top_k=5" -Headers $authHeaders -Method Get -TimeoutSec 5
  if ($null -eq $match.matches) {
    throw "Match check failed"
  }

  $viewport = Invoke-RestMethod "$base/hex/viewport?north=37.8&south=37.3&east=127.2&west=126.7&limit=30" -Headers $authHeaders -Method Get -TimeoutSec 5
  if ($null -eq $viewport.total_in_view) {
    throw "Viewport check failed"
  }

  Write-Host "SMOKE_OK port=$port hexes=$($stats.total_hexagons) matches=$($match.matches.Count) in_view=$($viewport.total_in_view)" -ForegroundColor Green
}
finally {
  if ($proc -and -not $proc.HasExited) {
    Stop-Process -Id $proc.Id -Force
  }
}
