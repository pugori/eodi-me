# EODI.ME Go API Server Build Script
# PowerShell 7+ recommended

param(
    [Parameter(Mandatory=$false)]
    [ValidateSet("build", "run", "test", "bench", "docker", "clean", "all")]
    [string]$Action = "menu"
)

$ErrorActionPreference = "Stop"

function Show-Menu {
    Write-Host "`n==================================" -ForegroundColor Cyan
    Write-Host "  EODI.ME Go API Build Menu" -ForegroundColor Cyan
    Write-Host "==================================" -ForegroundColor Cyan
    Write-Host "[1] Build binary (optimized)" -ForegroundColor Yellow
    Write-Host "[2] Run server" -ForegroundColor Yellow
    Write-Host "[3] Run tests" -ForegroundColor Yellow
    Write-Host "[4] Run benchmarks" -ForegroundColor Yellow
    Write-Host "[5] Build Docker image" -ForegroundColor Yellow
    Write-Host "[6] Clean build artifacts" -ForegroundColor Yellow
    Write-Host "[7] Install dependencies" -ForegroundColor Yellow
    Write-Host "[8] Format code" -ForegroundColor Yellow
    Write-Host "[0] Exit" -ForegroundColor Red
    Write-Host "==================================" -ForegroundColor Cyan

    $choice = Read-Host "`nSelect option"
    return $choice
}

function Build-Binary {
    Write-Host "`n[BUILD] Building optimized binary..." -ForegroundColor Green
    
    $env:CGO_ENABLED = "1"
    go build -ldflags="-s -w" -o eodi-api.exe cmd/server/main.go
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "[SUCCESS] Binary built: eodi-api.exe" -ForegroundColor Green
        $size = (Get-Item eodi-api.exe).Length / 1MB
        Write-Host "Binary size: $([math]::Round($size, 2)) MB" -ForegroundColor Cyan
    } else {
        Write-Host "[ERROR] Build failed" -ForegroundColor Red
        exit 1
    }
}

function Run-Server {
    Write-Host "`n[RUN] Starting server..." -ForegroundColor Green
    
    if (-not (Test-Path ".env")) {
        Write-Host "[WARNING] .env not found, using defaults" -ForegroundColor Yellow
    }
    
    go run cmd/server/main.go
}

function Run-Tests {
    Write-Host "`n[TEST] Running tests..." -ForegroundColor Green
    
    go test -v ./...
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "[SUCCESS] All tests passed" -ForegroundColor Green
    } else {
        Write-Host "[ERROR] Tests failed" -ForegroundColor Red
        exit 1
    }
}

function Run-Benchmarks {
    Write-Host "`n[BENCH] Running benchmarks..." -ForegroundColor Green
    
    go test -bench=. -benchmem ./tests/
}

function Build-DockerImage {
    Write-Host "`n[DOCKER] Building Docker image..." -ForegroundColor Green
    
    docker build -t eodi-api:latest .
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "[SUCCESS] Docker image built" -ForegroundColor Green
        Write-Host "Run with: docker run -p 8000:8000 --env-file .env eodi-api:latest" -ForegroundColor Cyan
    } else {
        Write-Host "[ERROR] Docker build failed" -ForegroundColor Red
        exit 1
    }
}

function Clean-Artifacts {
    Write-Host "`n[CLEAN] Cleaning build artifacts..." -ForegroundColor Green
    
    Remove-Item -Path "eodi-api.exe" -ErrorAction SilentlyContinue
    Remove-Item -Path "eodi-api" -ErrorAction SilentlyContinue
    
    go clean
    
    Write-Host "[SUCCESS] Cleaned" -ForegroundColor Green
}

function Install-Dependencies {
    Write-Host "`n[DEPS] Installing dependencies..." -ForegroundColor Green
    
    go mod download
    go mod tidy
    
    Write-Host "[SUCCESS] Dependencies installed" -ForegroundColor Green
}

function Format-Code {
    Write-Host "`n[FMT] Formatting code..." -ForegroundColor Green
    
    go fmt ./...
    
    Write-Host "[SUCCESS] Code formatted" -ForegroundColor Green
}

# Main execution
if ($Action -eq "menu") {
    while ($true) {
        $choice = Show-Menu
        
        switch ($choice) {
            "1" { Build-Binary }
            "2" { Run-Server }
            "3" { Run-Tests }
            "4" { Run-Benchmarks }
            "5" { Build-DockerImage }
            "6" { Clean-Artifacts }
            "7" { Install-Dependencies }
            "8" { Format-Code }
            "0" { 
                Write-Host "`nExiting..." -ForegroundColor Cyan
                exit 0 
            }
            default { 
                Write-Host "`nInvalid option" -ForegroundColor Red 
            }
        }
        
        Write-Host "`nPress any key to continue..."
        $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
    }
} else {
    switch ($Action) {
        "build" { Build-Binary }
        "run" { Run-Server }
        "test" { Run-Tests }
        "bench" { Run-Benchmarks }
        "docker" { Build-DockerImage }
        "clean" { Clean-Artifacts }
        "all" {
            Clean-Artifacts
            Install-Dependencies
            Build-Binary
            Run-Tests
        }
    }
}
