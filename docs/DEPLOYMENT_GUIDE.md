# 배포 가이드

프로젝트 배포 가이드입니다.

## 사전 요구사항

### 소프트웨어

- Docker 20.10+
- Docker Compose 2.0+
- Git 2.30+

## 환경 설정

### 환경 변수

```bash
cp .env.example .env.production
```

필수 설정:
- ENVIRONMENT=production
- DEBUG=false
- DATABASE_URL (설정 필요)
- API_KEY (강력한 키 생성)
- JWT_SECRET (강력한 시크릿 생성)
ALLOWED_METHODS=GET,POST,PUT,DELETE,OPTIONS
ALLOWED_HEADERS=*
ALLOW_CREDENTIALS=true

# Rate Limiting
RATE_LIMIT_ENABLED=true
RATE_LIMIT_REQUESTS=100
RATE_LIMIT_WINDOW=60

# Supabase
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_KEY=your-anon-key
SUPABASE_SERVICE_KEY=your-service-key

# Lemon Squeezy
LEMON_SQUEEZY_API_KEY=your-api-key
LEMON_SQUEEZY_WEBHOOK_SECRET=your-webhook-secret

# 캐싱 (Redis)
CACHE_TYPE=redis
REDIS_URL=redis://redis:6379/0
CACHE_TTL=3600

# 모니터링
SENTRY_DSN=https://xxx@xxx.ingest.sentry.io/xxx
ENABLE_METRICS=true
LOG_LEVEL=INFO

# 스토리지 (S3 또는 GCS)
STORAGE_TYPE=s3
S3_BUCKET=eodime-data-prod
S3_REGION=us-east-1
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key
```

### 2. 보안 키 생성

```bash
# API 키 생성 (64자)
openssl rand -hex 32

# JWT 시크릿 생성 (64자)
openssl rand -hex 32

# Webhook 시크릿 생성
openssl rand -base64 32
```

### 3. SSL/TLS 인증서

**Let's Encrypt (권장):**

```bash
# Certbot 설치
sudo apt-get install certbot

# 인증서 발급
sudo certbot certonly --standalone -d eodi.me -d api.eodi.me

# 인증서 위치
# /etc/letsencrypt/live/eodi.me/fullchain.pem
# /etc/letsencrypt/live/eodi.me/privkey.pem
```

**자동 갱신 설정:**

```bash
# Cron 추가
sudo crontab -e

# 매일 자정에 갱신 체크
0 0 * * * certbot renew --quiet
```

## Docker 배포

### 단일 서버 배포

**1. 저장소 클론:**

```bash
git clone https://github.com/yourusername/eodi.me.git /opt/eodime
cd /opt/eodime
```

**2. 환경 변수 설정:**

```bash
cp .env.example .env
nano .env  # 프로덕션 설정으로 수정
```

**3. Docker Compose로 배포:**

```bash
# 프로덕션 이미지 빌드
docker-compose -f docker-compose.yml build --no-cache

# 전체 스택 시작 (detached)
docker-compose -f docker-compose.yml --profile nginx up -d

# 로그 확인
docker-compose logs -f api
```

**4. 헬스 체크:**

```bash
# API 헬스 체크
curl http://localhost:8000/health

# Nginx를 통한 접속
curl https://api.eodi.me/health
```

### Docker Compose 구성

**서비스 구성:**

- `api`: FastAPI 백엔드 (4 workers)
- `postgres`: PostgreSQL 15 데이터베이스
- `redis`: Redis 캐시
- `nginx`: Reverse proxy + TLS termination
- `prometheus`: 메트릭 수집
- `grafana`: 대시보드
- `collector`: 데이터 수집 (선택)

**볼륨:**

- `postgres-data`: PostgreSQL 데이터
- `redis-data`: Redis 데이터
- `prometheus-data`: 메트릭 데이터
- `grafana-data`: Grafana 설정

**네트워크:**

- `eodime-network`: 내부 브리지 네트워크 (172.20.0.0/16)

### 리소스 제한 설정

**docker-compose.yml에 추가:**

```yaml
services:
  api:
    deploy:
      resources:
        limits:
          cpus: '2.0'
          memory: 4G
        reservations:
          cpus: '1.0'
          memory: 2G
```

## Kubernetes 배포

### 1. 네임스페이스 생성

```bash
kubectl create namespace eodime-prod
kubectl config set-context --current --namespace=eodime-prod
```

### 2. 시크릿 생성

```bash
# Docker 레지스트리 시크릿
kubectl create secret docker-registry regcred \
  --docker-server=ghcr.io \
  --docker-username=YOUR_USERNAME \
  --docker-password=YOUR_TOKEN

# 환경 변수 시크릿
kubectl create secret generic eodime-secrets \
  --from-env-file=.env.production
```

### 3. ConfigMap 생성

```bash
kubectl create configmap eodime-config \
  --from-file=config/settings.py \
  --from-file=config/logging.py
```

### 4. 매니페스트 적용

```bash
# 전체 배포
kubectl apply -f deployment/kubernetes/

# 또는 개별 적용
kubectl apply -f deployment/kubernetes/deployment.yml
kubectl apply -f deployment/kubernetes/service.yml
kubectl apply -f deployment/kubernetes/ingress.yml
kubectl apply -f deployment/kubernetes/hpa.yml
```

### 5. Helm 차트 사용 (권장)

```bash
# Helm 레포지토리 추가
helm repo add eodime https://charts.eodi.me
helm repo update

# 배포
helm install eodime-prod eodime/eodime \
  --namespace eodime-prod \
  --values values-production.yaml

# 업그레이드
helm upgrade eodime-prod eodime/eodime \
  --namespace eodime-prod \
  --values values-production.yaml
```

**values-production.yaml 예시:**

```yaml
replicaCount: 3

image:
  repository: ghcr.io/yourusername/eodime
  tag: v1.0.0
  pullPolicy: IfNotPresent

resources:
  limits:
    cpu: 2000m
    memory: 4Gi
  requests:
    cpu: 1000m
    memory: 2Gi

autoscaling:
  enabled: true
  minReplicas: 3
  maxReplicas: 10
  targetCPUUtilizationPercentage: 70
  targetMemoryUtilizationPercentage: 80

postgresql:
  enabled: true
  auth:
    username: eodime
    password: STRONG_PASSWORD
    database: eodime_prod
  primary:
    persistence:
      size: 100Gi

redis:
  enabled: true
  master:
    persistence:
      size: 10Gi

ingress:
  enabled: true
  className: nginx
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt-prod
  hosts:
    - host: api.eodi.me
      paths:
        - path: /
          pathType: Prefix
  tls:
    - secretName: api-eodi-me-tls
      hosts:
        - api.eodi.me
```

### 6. 모니터링

```bash
# Pod 상태 확인
kubectl get pods

# 로그 확인
kubectl logs -f deployment/eodime-api

# 메트릭 확인
kubectl top pods
kubectl top nodes

# HPA 상태
kubectl get hpa
```

## CI/CD 설정

### GitHub Actions

**.github/workflows/deploy.yml:**

```yaml
name: Deploy to Production

on:
  release:
    types: [published]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v2
      
      - name: Login to GitHub Container Registry
        uses: docker/login-action@v2
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      
      - name: Build and push
        uses: docker/build-push-action@v4
        with:
          context: .
          push: true
          tags: |
            ghcr.io/${{ github.repository }}:latest
            ghcr.io/${{ github.repository }}:${{ github.event.release.tag_name }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
      
      - name: Deploy to Kubernetes
        uses: azure/k8s-deploy@v4
        with:
          namespace: eodime-prod
          manifests: |
            deployment/kubernetes/deployment.yml
            deployment/kubernetes/service.yml
          images: |
            ghcr.io/${{ github.repository }}:${{ github.event.release.tag_name }}
```

### GitLab CI/CD

**.gitlab-ci.yml:**

```yaml
stages:
  - build
  - test
  - deploy

variables:
  DOCKER_HOST: tcp://docker:2375
  DOCKER_TLS_CERTDIR: ""

build:
  stage: build
  image: docker:latest
  services:
    - docker:dind
  script:
    - docker build -t $CI_REGISTRY_IMAGE:$CI_COMMIT_TAG .
    - docker push $CI_REGISTRY_IMAGE:$CI_COMMIT_TAG
  only:
    - tags

deploy:production:
  stage: deploy
  image: bitnami/kubectl:latest
  script:
    - kubectl config set-cluster k8s --server="$KUBE_URL" --insecure-skip-tls-verify=true
    - kubectl config set-credentials admin --token="$KUBE_TOKEN"
    - kubectl config set-context default --cluster=k8s --user=admin
    - kubectl config use-context default
    - kubectl set image deployment/eodime-api eodime-api=$CI_REGISTRY_IMAGE:$CI_COMMIT_TAG -n eodime-prod
  only:
    - tags
  when: manual
```

## 모니터링 설정

### Prometheus + Grafana

**1. Prometheus 설정:**

```yaml
# deployment/kubernetes/prometheus-config.yml
global:
  scrape_interval: 15s
  evaluation_interval: 15s

scrape_configs:
  - job_name: 'eodime-api'
    kubernetes_sd_configs:
      - role: pod
        namespaces:
          names:
            - eodime-prod
    relabel_configs:
      - source_labels: [__meta_kubernetes_pod_label_app]
        action: keep
        regex: eodime-api
```

**2. Grafana 대시보드 Import:**

```bash
# 사전 구성된 대시보드 ID
# - API Performance: 12345
# - System Resources: 12346
# - Database: 12347
```

### Sentry 연동

```bash
# .env에 추가
SENTRY_DSN=https://xxx@xxx.ingest.sentry.io/xxx
SENTRY_ENVIRONMENT=production
SENTRY_TRACES_SAMPLE_RATE=0.1
```

### Uptime Monitoring

**외부 서비스 사용 (권장):**
- UptimeRobot
- Pingdom
- StatusCake

**엔드포인트:**
- `https://api.eodi.me/health`
- 체크 주기: 5분
- 알림: 이메일, Slack, PagerDuty

## 백업 및 복구

### 데이터베이스 백업

**자동 백업 (cron):**

```bash
# /etc/cron.daily/eodime-backup.sh
#!/bin/bash

BACKUP_DIR="/backups/eodime"
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/db_backup_$DATE.sql.gz"

# PostgreSQL 덤프
docker exec eodime-postgres pg_dump -U eodime eodime_prod | gzip > $BACKUP_FILE

# S3에 업로드
aws s3 cp $BACKUP_FILE s3://eodime-backups/database/

# 7일 이상 된 로컬 백업 삭제
find $BACKUP_DIR -name "*.sql.gz" -mtime +7 -delete

echo "Backup completed: $BACKUP_FILE"
```

**실행 권한 부여:**

```bash
chmod +x /etc/cron.daily/eodime-backup.sh
```

### 데이터베이스 복구

```bash
# 백업 다운로드
aws s3 cp s3://eodime-backups/database/db_backup_20240115_030000.sql.gz /tmp/

# 복구
gunzip -c /tmp/db_backup_20240115_030000.sql.gz | \
  docker exec -i eodime-postgres psql -U eodime eodime_prod
```

### 볼륨 백업

```bash
# Docker 볼륨 백업
docker run --rm \
  -v eodime_postgres-data:/data \
  -v /backups:/backup \
  alpine tar czf /backup/postgres-data-$(date +%Y%m%d).tar.gz /data

# 복구
docker run --rm \
  -v eodime_postgres-data:/data \
  -v /backups:/backup \
  alpine tar xzf /backup/postgres-data-20240115.tar.gz -C /
```

## 보안

### 방화벽 설정

```bash
# UFW (Ubuntu)
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp    # SSH
sudo ufw allow 80/tcp    # HTTP
sudo ufw allow 443/tcp   # HTTPS
sudo ufw enable

# iptables
sudo iptables -A INPUT -p tcp --dport 22 -j ACCEPT
sudo iptables -A INPUT -p tcp --dport 80 -j ACCEPT
sudo iptables -A INPUT -p tcp --dport 443 -j ACCEPT
sudo iptables -A INPUT -j DROP
```

### Fail2Ban 설정

```bash
# 설치
sudo apt-get install fail2ban

# /etc/fail2ban/jail.local
[DEFAULT]
bantime = 3600
findtime = 600
maxretry = 5

[sshd]
enabled = true

[nginx-limit-req]
enabled = true
filter = nginx-limit-req
logpath = /var/log/nginx/error.log
```

### SSL/TLS 설정 (Nginx)

```nginx
# /etc/nginx/sites-available/eodime

server {
    listen 443 ssl http2;
    server_name api.eodi.me;

    ssl_certificate /etc/letsencrypt/live/api.eodi.me/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.eodi.me/privkey.pem;
    
    # Modern SSL configuration
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-RSA-AES256-GCM-SHA512:DHE-RSA-AES256-GCM-SHA512;
    ssl_prefer_server_ciphers off;
    
    # HSTS
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    
    # Security headers
    add_header X-Frame-Options "DENY" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    
    location / {
        proxy_pass http://localhost:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

server {
    listen 80;
    server_name api.eodi.me;
    return 301 https://$server_name$request_uri;
}
```

## 트러블슈팅

### 자주 발생하는 문제

**1. 컨테이너가 시작하지 않음**

```bash
# 로그 확인
docker-compose logs api

# 일반적인 원인:
# - 환경 변수 누락
# - 포트 충돌
# - 볼륨 권한 문제
```

**2. 데이터베이스 연결 실패**

```bash
# PostgreSQL 상태 확인
docker-compose exec postgres pg_isready

# 연결 테스트
docker-compose exec api python -c "from database import engine; engine.connect()"
```

**3. 높은 메모리 사용**

```bash
# 컨테이너 리소스 확인
docker stats

# 해결: Worker 수 줄이기
WORKERS=2  # .env에서 조정
```

**4. 느린 응답 시간**

```bash
# 메트릭 확인
curl http://localhost:8000/metrics | grep duration

# 해결:
# - Redis 캐싱 활성화
# - DB 커넥션 풀 크기 증가
# - FAISS 인덱스 최적화
```

### 로그 분석

```bash
# 에러 로그만 필터링
docker-compose logs api | grep ERROR

# JSON 로그 파싱
docker-compose logs api | jq 'select(.level == "ERROR")'

# 특정 시간대 로그
docker-compose logs --since 2024-01-15T10:00:00 api
```

### 성능 최적화

**1. Database Connection Pooling:**

```env
DATABASE_POOL_SIZE=20
DATABASE_MAX_OVERFLOW=10
DATABASE_POOL_TIMEOUT=30
```

**2. Redis 캐싱:**

```env
CACHE_TYPE=redis
CACHE_TTL=3600
```

**3. Worker 수 조정:**

```env
# CPU 코어 수 × 2 + 1
WORKERS=9  # 4 코어 서버
```

**4. FAISS 인덱스 최적화:**

```env
FAISS_INDEX_TYPE=IVF1024,Flat
FAISS_NPROBE=32
```

## 체크리스트

### 배포 전 체크리스트

- [ ] 환경 변수 설정 완료 (.env.production)
- [ ] 보안 키 생성 (API_KEY, JWT_SECRET)
- [ ] SSL/TLS 인증서 발급
- [ ] 데이터베이스 백업 설정
- [ ] 모니터링 설정 (Sentry, Prometheus)
- [ ] 방화벽 설정
- [ ] 리소스 제한 설정
- [ ] 헬스 체크 엔드포인트 테스트
- [ ] 로그 rotation 설정
- [ ] 백업 복구 테스트

### 배포 후 체크리스트

- [ ] API 헬스 체크 (https://api.eodi.me/health)
- [ ] SSL/TLS 확인 (https://www.ssllabs.com/ssltest/)
- [ ] 로드 테스트 (k6, Locust)
- [ ] 모니터링 대시보드 확인
- [ ] 알림 설정 테스트
- [ ] 백업 자동화 확인
- [ ] 로그 수집 확인
- [ ] 보안 스캔 (OWASP ZAP)

## 추가 리소스

- [Docker 공식 문서](https://docs.docker.com/)
- [Kubernetes 공식 문서](https://kubernetes.io/docs/)
- [Nginx 설정 가이드](https://nginx.org/en/docs/)
- [PostgreSQL 성능 튜닝](https://wiki.postgresql.org/wiki/Performance_Optimization)
- [FastAPI 배포 가이드](https://fastapi.tiangolo.com/deployment/)

---

**문의:** devops@eodi.me
