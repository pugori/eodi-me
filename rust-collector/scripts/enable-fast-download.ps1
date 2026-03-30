param(
    [switch]$InstallIfMissing = $true
)

$ErrorActionPreference = 'Stop'

function Test-Aria2 {
    try {
        $null = Get-Command aria2c -ErrorAction Stop
        return $true
    }
    catch {
        return $false
    }
}

if (Test-Aria2) {
    Write-Host "aria2c already installed." -ForegroundColor Green
    aria2c --version | Select-Object -First 2
    exit 0
}

Write-Host "aria2c not found." -ForegroundColor Yellow

if (-not $InstallIfMissing) {
    Write-Host "Install skipped (--InstallIfMissing:`$false)." -ForegroundColor Yellow
    exit 1
}

if (Get-Command winget -ErrorAction SilentlyContinue) {
    Write-Host "Installing aria2 via winget..." -ForegroundColor Cyan
    winget install --id aria2.aria2 --source winget --accept-package-agreements --accept-source-agreements
}
elseif (Get-Command choco -ErrorAction SilentlyContinue) {
    Write-Host "Installing aria2 via choco..." -ForegroundColor Cyan
    choco install aria2 -y
}
else {
    Write-Host "No package manager found (winget/choco). Please install aria2 manually." -ForegroundColor Red
    exit 2
}

if (Test-Aria2) {
    Write-Host "aria2c installed successfully." -ForegroundColor Green
    aria2c --version | Select-Object -First 2
    exit 0
}

Write-Host "aria2c installation may have failed. Open a new terminal and retry." -ForegroundColor Red
exit 3
