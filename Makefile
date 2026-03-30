# ============================================================================
# EODI.ME — Build Automation
# ============================================================================

.PHONY: help build build-collector build-api build-engine build-tauri \
        check check-collector check-api check-engine \
        test test-go test-rust lint fmt \
        docker-up docker-down docker-logs docker-build docker-build-api \
        clean

# Default target
.DEFAULT_GOAL := help

# ============================================================================
# Variables
# ============================================================================
DOCKER_COMPOSE := docker compose
PROJECT_NAME := eodi-me

# Build tags for Go API (server-only builds don't embed binaries)
GO_BUILD_TAGS ?= no_engine,no_window,no_frontend

# Colors
CYAN  := \033[0;36m
GREEN := \033[0;32m
NC    := \033[0m

# ============================================================================
# Help
# ============================================================================
help:  ## Show this help message
	@echo "$(CYAN)EODI.ME — Make Commands$(NC)"
	@echo ""
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z_-]+:.*?## / {printf "  $(CYAN)%-22s$(NC) %s\n", $$1, $$2}' $(MAKEFILE_LIST)

# ============================================================================
# Build
# ============================================================================
build: build-engine build-api build-tauri  ## Build all components

build-collector:  ## Build Rust data collector
	cd rust-collector && cargo build --release --bin eodi-collector

build-api:  ## Build Go API server (server-only, no embedded binaries)
	cd go-api && go build -tags "$(GO_BUILD_TAGS)" -o eodi-api ./cmd/server/

build-engine:  ## Build Rust engine server
	cd engine-server && cargo build --release

build-tauri:  ## Build Tauri desktop app (frontend + Rust shell)
	cd tauri-shell && npm run build

# ============================================================================
# Type-check / lint (no compilation artifacts)
# ============================================================================
check: check-engine check-api check-collector  ## Run type checks on all components

check-collector:  ## cargo check on rust-collector
	cd rust-collector && cargo check

check-api:  ## go vet on go-api
	cd go-api && go vet -tags "$(GO_BUILD_TAGS)" ./...

check-engine:  ## cargo check on engine-server
	cd engine-server && cargo check

# ============================================================================
# Test
# ============================================================================
test: test-go test-rust  ## Run all tests

test-go:  ## Run Go API tests
	cd go-api && go test -tags "$(GO_BUILD_TAGS)" -v ./...

test-rust:  ## Run Rust tests (engine + collector)
	cd engine-server && cargo test
	cd rust-collector && cargo test

# ============================================================================
# Lint & Format
# ============================================================================
lint:  ## Lint all components
	cd engine-server && cargo clippy -- -D warnings
	cd rust-collector && cargo clippy -- -D warnings
	cd go-api && go vet -tags "$(GO_BUILD_TAGS)" ./...
	cd tauri-shell && npm run lint

fmt:  ## Format all source code
	cd engine-server && cargo fmt
	cd rust-collector && cargo fmt
	cd go-api && gofmt -w .

# ============================================================================
# Docker (production deployment)
# ============================================================================
docker-build:  ## Build all Docker images
	$(DOCKER_COMPOSE) build

docker-build-engine:  ## Build Docker image for engine-server
	docker build -f Dockerfile.engine -t $(PROJECT_NAME)-engine:latest .

docker-build-api:  ## Build Docker image for go-api
	docker build -f go-api/Dockerfile -t $(PROJECT_NAME)-api:latest go-api/

docker-up:  ## Start all services
	$(DOCKER_COMPOSE) up -d

docker-up-full:  ## Start all services with HTTPS and monitoring
	$(DOCKER_COMPOSE) --profile https --profile monitoring up -d

docker-down:  ## Stop all services
	$(DOCKER_COMPOSE) down

docker-logs:  ## Follow service logs
	$(DOCKER_COMPOSE) logs -f

# ============================================================================
# Cleanup
# ============================================================================
clean:  ## Remove build artifacts
	cd rust-collector && cargo clean
	cd engine-server  && cargo clean
	cd go-api         && go clean ./... && rm -f eodi-api
	cd tauri-shell    && rm -rf dist node_modules
