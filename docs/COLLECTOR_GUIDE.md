# 데이터 수집기 (Collector) 사용 가이드

외부 데이터 소스에서 polite하게 데이터를 수집하는 시스템입니다.

## 주요 기능

### 1️⃣ 중단 후 재개 (Resume on Interruption)

**자동 재개 기능**: 수집 중 중단되어도 이미 수집한 데이터는 건너뜁니다.

```bash
# 첫 실행 (중간에 Ctrl+C로 중단)
python -m collector.cli

# 다시 실행 → 이미 수집한 URL은 자동 건너뜀
python -m collector.cli
```

**작동 방식:**
- 각 URL을 수집할 때 메타데이터를 `data/raw/meta/{hash}.json`에 저장
- 다음 실행 시 이 메타데이터를 확인하여 이미 수집한 URL은 건너뜀
- 로그 출력: `Skipped (already collected): https://example.com/data.zip`

**비활성화 방법** (모든 URL 재수집):
```bash
python -m collector.cli --no-skip-existing
```

### 2️⃣ 업데이트 감지 (Update Detection)

**HTTP 캐싱 헤더 활용**: ETag와 Last-Modified를 사용하여 데이터 변경 여부 확인

```bash
# 기본값: 업데이트 확인 활성화
python -m collector.cli
```

**작동 방식:**
1. 첫 수집 시 서버의 `ETag`와 `Last-Modified` 헤더 저장
2. 재수집 시:
   - HEAD 요청에 `If-None-Match: {etag}` 헤더 포함
   - HEAD 요청에 `If-Modified-Since: {last_modified}` 헤더 포함
3. 서버가 `304 Not Modified` 응답 → 다운로드 건너뜀
4. 로그 출력: `Skipped (not modified): https://example.com/data.zip`

**저장되는 메타데이터:**
```json
{
  "url": "https://example.com/population.csv",
  "etag": "\"686897696a7c876b7e\"",
  "last_modified": "Wed, 21 Oct 2015 07:28:00 GMT",
  "collected_at": "2026-02-17T12:34:56.789000",
  "result": {
    "status": 200,
    "size": 1048576,
    "downloaded_file": "/data/raw/tmp/population.csv"
  }
}
```

**비활성화 방법** (항상 재다운로드):
```bash
python -m collector.cli --no-check-updates
```

### 3️⃣ 디스크 공간 관리 (Disk Space Management)

#### A. 최소 여유 공간 확인

수집 전 디스크 여유 공간을 자동으로 확인합니다.

```bash
# 기본값: 최소 1GB (1000MB) 필요
python -m collector.cli

# 최소 여유 공간 변경 (500MB)
python -m collector.cli --min-free-space 500
```

**작동 방식:**
- 각 파일 다운로드 전 `psutil.disk_usage()`로 여유 공간 확인
- 여유 공간 부족 시:
  1. 자동으로 임시 파일 정리 시도
  2. 여전히 부족하면 다운로드 건너뜀
  3. 로그 경고: `Low disk space: 450MB free (minimum: 1000MB)`

#### B. 임시 파일 자동 정리

오래된 임시 파일을 자동으로 삭제합니다.

```python
# 1시간(3600초) 이상 된 임시 파일 자동 삭제
if now - file.stat().st_mtime > 3600:
    file.unlink()
```

**임시 파일 위치:**
```
data/raw/tmp/
├── population.geojson.gz   (다운로드 중)
├── places.parquet          (다운로드 중)
└── old_file.zip            (1시간 경과 → 자동 삭제)
```

#### C. 파일 보관 vs 메타데이터만 (기본값)

**기본 동작** (keep_files=False):
- 파일 다운로드 → 메타데이터 추출 → **파일 삭제**
- 디스크 공간 절약

```bash
# 기본: 메타데이터만 저장, 파일 삭제
python -m collector.cli

# 파일 보관 (주의: 디스크 필요)
python -m collector.cli --keep-files
```

**저장되는 정보** (파일 삭제해도):
```json
{
  "url": "https://...",
  "status": 200,
  "downloaded_file": "/data/raw/tmp/data.zip",
  "size": 52428800,
  "members": [
    "data/cities.csv",
    "data/metadata.json"
  ],
  "etag": "...",
  "last_modified": "..."
}
```

## 실제 사용 시나리오

### 시나리오 1: 일일 업데이트 확인

```bash
#!/bin/bash
# daily-update.sh - 매일 실행되는 크론 작업

python -m collector.cli \
  --skip-existing \        # 새 URL만 수집
  --check-updates \        # 변경된 것만 재수집
  --min-free-space 2000    # 2GB 여유 공간 확보
```

**결과:**
- Day 1: 100개 URL 수집 (신규)
- Day 2: 5개 URL만 수집 (업데이트된 것만)
- Day 3: 2개 URL만 수집

### 시나리오 2: 대용량 데이터 수집

```bash
# 디스크 공간 부족 대비
python -m collector.cli \
  --min-free-space 5000 \     # 5GB 여유 공간 필요
  --keep-files=false \        # 메타데이터만 저장
  --max-tasks 2               # 동시 다운로드 제한
```

**효과:**
- 여유 공간 5GB 미만 시 자동 중단
- 파일 삭제로 디스크 절약
- 동시 다운로드 제한으로 안정성 확보

### 시나리오 3: 중단 후 재개

```bash
# 첫 실행 (1000개 URL 중 500개 수집 후 중단)
python -m collector.cli
# Ctrl+C

# 나중에 재개 (나머지 500개만 수집)
python -m collector.cli
# ✅ Skipped (already collected): ... (500개)
# 🔄 Collecting: ... (나머지 500개)
```

## CLI 옵션 전체 목록

```bash
python -m collector.cli [OPTIONS]

데이터 수집 옵션:
  --jobs-from-cities        cities15000.txt 기반 URL 자동 생성
  --urls URL [URL...]       명시적 URL 리스트

동작 제어:
  --no-skip-existing        중복 수집 (재개 기능 비활성화)
  --no-check-updates        업데이트 확인 안 함 (항상 재다운로드)
  --no-prefer-files         API 응답도 수집 (파일만 제한 해제)
  
디스크 관리:
  --min-free-space MB       최소 여유 공간 (기본: 1000MB)
  --keep-files              다운로드 파일 보관 (기본: 삭제)

네트워크:
  --concurrency N           동시 작업 수 (기본: 자동)
  --per-domain-delay SEC    도메인당 대기 시간 (기본: 1.0초)
  --proxy URL               HTTP 프록시
  --user-agent STRING       User-Agent 헤더

출력:
  --out DIR                 출력 디렉터리 (기본: data/raw)
  --log-file PATH           로그 파일 (기본: <out>/collector.log)
```

## Python API 사용

```python
from collector import Collector

# 기본 사용
c = Collector(
    output_dir="data/raw",
    skip_existing=True,        # 재개 기능
    check_updates=True,        # 업데이트 확인
    min_free_space_mb=1000,    # 최소 1GB
    keep_files=False,          # 메타데이터만
)

await c.run([
    "https://example.com/cities.geojson.gz",
    "https://example.com/population.csv",
])
```

## 메타데이터 구조

### 도메인별 JSONL
```bash
data/raw/
├── example.com.jl          # 도메인별 수집 기록
├── overturemaps.org.jl
└── openstreetmap.org.jl
```

### URL별 메타데이터
```bash
data/raw/meta/
├── a1b2c3d4e5f6.json      # SHA1(URL) 해시
├── f6e5d4c3b2a1.json
└── ...
```

### 메타데이터 내용
```json
{
  "url": "https://example.com/data.zip",
  "domain": "example.com",
  "collected_at": "2026-02-17T12:34:56.789000",
  "result": {
    "url": "https://example.com/data.zip",
    "status": 200,
    "downloaded_file": "/data/raw/tmp/data.zip",
    "size": 1048576,
    "members": ["cities.csv", "meta.json"],
    "etag": "\"686897696a7c876b7e\"",
    "last_modified": "Wed, 21 Oct 2015 07:28:00 GMT"
  },
  "etag": "\"686897696a7c876b7e\"",
  "last_modified": "Wed, 21 Oct 2015 07:28:00 GMT"
}
```

## 트러블슈팅

### Q1: "Low disk space" 경고가 계속 나옵니다
```bash
# 해결 방법 1: 최소 여유 공간 줄이기
python -m collector.cli --min-free-space 500

# 해결 방법 2: 임시 파일 수동 정리
rm -rf data/raw/tmp/*

# 해결 방법 3: 파일 보관 비활성화 확인
python -m collector.cli  # keep_files=False (기본값)
```

### Q2: 이미 수집한 데이터를 다시 받고 싶습니다
```bash
# 방법 1: 특정 URL만 재수집
rm data/raw/meta/{hash}.json

# 방법 2: 전체 재수집
python -m collector.cli --no-skip-existing --no-check-updates

# 방법 3: 메타데이터 전체 삭제
rm -rf data/raw/meta/
```

### Q3: 업데이트된 데이터만 수집하고 싶습니다
```bash
# 매일 실행되는 스크립트
python -m collector.cli \
  --skip-existing \      # 새 URL만
  --check-updates        # 변경된 것만
```

## 성능 최적화

### 대용량 데이터 수집
```bash
python -m collector.cli \
  --concurrency 2 \            # 동시 작업 제한
  --min-free-space 5000 \      # 5GB 여유 공간
  --keep-files=false \         # 메타데이터만
  --per-domain-delay 2.0       # 안전한 간격
```

### 빠른 수집 (작은 파일)
```bash
python -m collector.cli \
  --concurrency 10 \           # 동시 작업 증가
  --min-free-space 500 \       # 낮은 제한
  --per-domain-delay 0.5       # 짧은 간격
```

## 요약

| 기능 | 기본값 | 설명 |
|-----|--------|------|
| **중단 후 재개** | ✅ ON | 이미 수집한 URL 건너뜀 |
| **업데이트 확인** | ✅ ON | ETag/Last-Modified 확인 |
| **디스크 관리** | 1000MB | 최소 여유 공간 확인 |
| **파일 보관** | ❌ OFF | 메타데이터만 저장 |
| **임시 파일 정리** | ✅ AUTO | 1시간 경과 파일 삭제 |

---

**문서 업데이트**: 2026-02-17  
**관련 문서**: [README.md](../README.md)
