.PHONY: help build run test bench clean docker

help: ## Show this help message
	@echo "Available targets:"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}'

build: ## Build the binary
	go build -ldflags="-s -w" -o eodi-api cmd/server/main.go

run: ## Run the server
	go run cmd/server/main.go

test: ## Run tests
	go test -v ./...

bench: ## Run benchmarks
	go test -bench=. -benchmem ./tests/

clean: ## Clean build artifacts
	rm -f eodi-api eodi-api.exe
	go clean

docker-build: ## Build Docker image
	docker build -t eodi-api:latest .

docker-run: ## Run Docker container
	docker run -p 8000:8000 --env-file .env eodi-api:latest

fmt: ## Format code
	go fmt ./...

lint: ## Run linter
	golangci-lint run

deps: ## Download dependencies
	go mod download
	go mod tidy

install: deps ## Install dependencies and build
	$(MAKE) build

prod-build: ## Build optimized production binary
	CGO_ENABLED=1 go build -ldflags="-s -w" -tags prod -o eodi-api cmd/server/main.go

dev: ## Run with hot reload (requires air)
	air

.DEFAULT_GOAL := help
