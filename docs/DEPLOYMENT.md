# EODI.ME Production Deployment Guide

## Prerequisites

- Docker 20.10+
- Docker Compose 2.0+
- Go 1.21+ (for development)
- Rust 1.75+ (for development)
- Node.js 20+ (for Tauri shell development)

## Quick Start

### 1. Production Deployment with Docker

```bash
# Build and start all services
docker-compose up -d

# View logs
docker-compose logs -f api-server

# Stop services
docker-compose down
```

### 2. Individual Service Deployment

#### Go API Server

```bash
cd go-api

# Build
go build -o api-server ./cmd/server

# Run
./api-server

# Or with Docker
docker build -t eodi-api .
docker run -p 8080:8080 eodi-api
```

#### Rust Collector

```bash
cd rust-collector

# Build
cargo build --release

# Run
./target/release/eodi-collector fetch-many -f urls.txt -w 10

# Or with Docker
docker build -t eodi-collector .
docker run eodi-collector fetch-many -f /app/urls.txt -w 10
```

#### Tauri Desktop Shell

```bash
cd tauri-shell

# Install dependencies
npm install

# Development
npm run tauri:dev

# Production build
npm run tauri:build
```

## Configuration

### Environment Variables

**API Server:**
- `GIN_MODE`: `release` or `debug`
- `SERVER_HOST`: Server host (default: `0.0.0.0`)
- `SERVER_PORT`: Server port (default: `8080`)
- `DB_PATH`: SQLite database path
- `RATE_LIMIT_RPS`: Requests per second limit (default: `10`)
- `RATE_LIMIT_BURST`: Burst size (default: `20`)

**Collector:**
- `RUST_LOG`: Log level (`debug`, `info`, `warn`, `error`)
- `COLLECTOR_WORKERS`: Number of concurrent workers
- `COLLECTOR_DELAY`: Delay between requests in seconds

## Monitoring

### Access Monitoring Tools

- **Prometheus**: http://localhost:9090
- **Grafana**: http://localhost:3000 (admin/admin)
- **API Metrics**: http://localhost:8080/metrics
- **Health Check**: http://localhost:8080/health

### Key Metrics

- `http_requests_total`: Total HTTP requests
- `http_request_duration_seconds`: Request latency
- `database_connected`: Database connection status
- `rate_limit_hits_total`: Rate limit violations

## Testing

### Run All Tests

```bash
# Rust Engine
cd rust-engine && cargo test

# Rust Collector
cd rust-collector && cargo test

# Go API
cd go-api && go test ./...

# Benchmarks
cd rust-engine && cargo bench
```

### Load Testing

```bash
# Using Apache Bench
ab -n 10000 -c 100 http://localhost:8080/health

# Using wrk
wrk -t12 -c400 -d30s http://localhost:8080/api/cities/search?q=Seoul
```

## Performance Tuning

### API Server

```go
// Increase worker pool size
router.MaxMultipartMemory = 8 << 20 // 8 MB

// Tune rate limits
cfg.RateLimitRPS = 100
cfg.RateLimitBurst = 200
```

### Collector

```rust
// Increase concurrency
let collector = Collector::new(
    user_agent,
    0.5,    // Faster delay
    30.0,
    500,    // More memory per worker
    50,     // More concurrent workers
);
```

## Security

### Production Checklist

- [ ] Change default admin passwords
- [ ] Enable HTTPS/TLS
- [ ] Configure proper CORS origins
- [ ] Set up JWT authentication
- [ ] Enable rate limiting
- [ ] Regular security audits
- [ ] Keep dependencies updated

### SSL/TLS Setup

```bash
# Generate self-signed certificate (development only)
openssl req -x509 -newkey rsa:4096 -nodes -keyout key.pem -out cert.pem -days 365

# Production: Use Let's Encrypt
certbot certonly --standalone -d yourdomain.com
```

## Backup and Recovery

### Database Backup

```bash
# Backup SQLite database
sqlite3 /data/eodi.db ".backup /backup/eodi_$(date +%Y%m%d).db"

# Restore
sqlite3 /data/eodi.db ".restore /backup/eodi_20240101.db"
```

### State Recovery

```bash
# Collector state files
/data/collector_queue.json
/data/collector_progress.json

# Restore by copying files back
cp /backup/*.json /data/
```

## Troubleshooting

### Common Issues

**API Server won't start:**
```bash
# Check port availability
lsof -i :8080

# Check logs
docker-compose logs api-server
```

**High memory usage:**
```bash
# Monitor memory
docker stats

# Reduce workers
export COLLECTOR_WORKERS=5
```

**Database locked:**
```bash
# Check for existing processes
ps aux | grep eodi

# Kill stale processes
killall api-server
```

## Scaling

### Horizontal Scaling

```yaml
# docker-compose.yml
services:
  api-server:
    deploy:
      replicas: 3

  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf
```

### Load Balancing

```nginx
upstream api_servers {
    least_conn;
    server api-server-1:8080;
    server api-server-2:8080;
    server api-server-3:8080;
}

server {
    listen 80;

    location /api {
        proxy_pass http://api_servers;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

## Support

For issues and questions:
- GitHub Issues: https://github.com/eodi-me/issues
- Email: support@eodi.me
- Documentation: https://docs.eodi.me
