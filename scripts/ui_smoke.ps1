param(
  [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'

function Invoke-Step {
  param(
    [Parameter(Mandatory = $true)][string]$Title,
    [Parameter(Mandatory = $true)][scriptblock]$Action
  )

  Write-Host "`n== $Title ==" -ForegroundColor Cyan
  & $Action
}

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

if (-not $SkipBuild) {
  Invoke-Step -Title 'Frontend build' -Action {
    npm --prefix tauri-shell run build | Out-Host
  }
}

Invoke-Step -Title 'Release smoke' -Action {
  & "$root\scripts\smoke_release.ps1"
}

Write-Host "`n== Manual UI checklist ==" -ForegroundColor Yellow
$checklist = @(
  'Search "성수동" -> result list appears',
  'Click one result -> map selection syncs to card',
  'Type 1-char query -> min-length hint visible',
  'Type nonsense query -> empty-state + suggestions visible',
  'Open Vibe Report and close -> state remains stable',
  'Open Settings modal and close via ESC / backdrop'
)

$failed = @()
for ($i = 0; $i -lt $checklist.Count; $i++) {
  $index = $i + 1
  $item = $checklist[$i]
  $answer = Read-Host "[$index/$($checklist.Count)] PASS? (y/n) $item"
  if ($answer -notmatch '^(y|Y)$') {
    $failed += $item
  }
}

if ($failed.Count -gt 0) {
  Write-Host "`nUI_SMOKE_FAILED" -ForegroundColor Red
  $failed | ForEach-Object { Write-Host " - $_" -ForegroundColor Red }
  exit 1
}

Write-Host "`nUI_SMOKE_OK" -ForegroundColor Green
exit 0
