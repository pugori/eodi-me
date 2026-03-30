# Multi-stage build for minimal production image
FROM golang:1.24-alpine AS builder

# Install build dependencies
RUN apk add --no-cache git gcc musl-dev sqlite-dev

# Set working directory
WORKDIR /build

# Copy go mod files
COPY go.mod go.sum ./
RUN go mod download

# Copy source code
COPY . .

# Build binary with optimizations
RUN CGO_ENABLED=1 GOOS=linux go build \
    -ldflags="-s -w" \
    -o eodi-api \
    cmd/server/main.go

# ============================================
# Production stage
FROM alpine:3.21

# Install runtime dependencies
RUN apk add --no-cache ca-certificates sqlite-libs

# Create non-root user
RUN addgroup -g 1000 eodi && \
    adduser -D -u 1000 -G eodi eodi

# Set working directory
WORKDIR /app

# Copy binary from builder
COPY --from=builder /build/eodi-api .

# Copy .env.example (rename to .env in production)
COPY .env.example .env.example

# Change ownership
RUN chown -R eodi:eodi /app

# Switch to non-root user
USER eodi

# Expose port
EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:8000/health || exit 1

# Run binary
CMD ["./eodi-api"]
