# EODI.ME Data Collector - 실행 가이드

## ✨ 주요 기능

### 1. 밴(Ban) 방지 시스템
- ✅ **Robots.txt 자동 준수**: 서버의 크롤링 정책 자동 확인
- ✅ **도메인별 Rate Limiting**: 서버 과부하 방지
- ✅ **Exponential Backoff**: 실패 시 지수적 대기 후 재시도
- ✅ **User-Agent 설정**: 정중한 봇 식별
- ✅ **Jitter 추가**: 동시 요청 분산

### 2. 파일 다운로드 및 디스크 관리
- ✅ **스트리밍 다운로드**: 메모리 효율적 처리
- ✅ **자동 파일 삭제**: 처리 완료 후 임시 파일 자동 정리
- ✅ **청크 단위 처리**: 대용량 파일도 메모리 부담 없이 처리
- ✅ **디스크 용량 절약**: auto-cleanup으로 공간 관리

### 3. 무료 API 전용
- ✅ **API 키 불필요**: 무료 공개 API만 사용
- ✅ **Rate Limit 준수**: 서비스 제한 자동 준수
- ✅ **법적 준수**: robots.txt, ToS 준수

## 빌드

```powershell
cd rust-collector
cargo build --release
```

## 실행 방법

### 1. 단일 URL 수집 (메모리 기반)
```powershell
cargo run --release -- fetch --url "https://restcountries.com/v3.1/capital/Seoul"
```

### 2. 여러 URL 수집 (파일에서)
```powershell
# 무료 API 테스트
cargo run --release -- fetch-many --file urls_test_free.txt --workers 3

# 실제 데이터 수집
cargo run --release -- fetch-many --file urls_free_apis.txt --workers 5
```

### 3. 파일 다운로드 (자동 정리)
```powershell
# 단일 파일 다운로드 및 처리 후 삭제
cargo run --release -- download --url "https://example.com/data.json" --auto-cleanup true

# 임시 파일 보관 (디버깅용)
cargo run --release -- download --url "https://example.com/data.json" --auto-cleanup false --temp-dir ./debug
```

### 4. 대량 파일 다운로드
```powershell
# 여러 파일 다운로드, 처리 후 자동 삭제
cargo run --release -- download-many --file urls_download.txt --workers 3 --auto-cleanup true

# 임시 디렉토리 지정
cargo run --release -- download-many --file urls_download.txt --temp-dir ./temp --auto-cleanup true
```

### 5. Robots.txt 테스트
```powershell
cargo run --release -- test-robots --url "https://example.com"
```

### 6. 벤치마크
```powershell
cargo run --release -- benchmark --requests 50 --url "https://jsonplaceholder.typicode.com/posts/1"
```

## 무료 API 사용 예제

### REST Countries API (키 불필요)
```powershell
# 단일 국가 정보
cargo run --release -- fetch --url "https://restcountries.com/v3.1/capital/Seoul"

# 여러 국가 정보
cargo run --release -- fetch-many --file urls_free_apis.txt --workers 5
```

### JSON Placeholder (테스트용)
```powershell
# 테스트 데이터 수집
cargo run --release -- fetch-many --file urls_test_free.txt --workers 3
```

## 설정

### 기본 설정 (main.rs에서 변경 가능)
- User-Agent: `eodi.me-collector/1.0`
- Default delay: 1초 (도메인별)
- Max delay: 60초
- Worker memory: 200MB
- Max concurrent: 20
- Timeout: 30초

### Rate Limiting (밴 방지)
- 도메인별 자동 속도 제한
- Robots.txt crawl-delay 자동 적용
- 지수 백오프 재시도
- 10-20% jitter로 요청 분산

### 디스크 관리
- `--auto-cleanup true`: 처리 완료 후 임시 파일 자동 삭제 (권장)
- `--auto-cleanup false`: 임시 파일 보관 (디버깅용)
- `--temp-dir ./temp`: 임시 디렉토리 지정

## 출력 형식

### 수집 결과 (JSONL)
```json
{"url":"https://...","timestamp":"2026-02-18T...","status":"success","size_bytes":1234,"data":"..."}
{"url":"https://...","timestamp":"2026-02-18T...","status":"error","size_bytes":0,"data":"error message"}
```

### 메트릭 정보
```
=== Collection Report ===
Output: "output"
Total: 10
Success: 9
Failed: 1
Success rate: 90.0%
Downloaded: 0.05 MB
Throughput: 0.12 MB/s
Rate: 1.8 req/s
Time: 5.2s
```

### 다운로드 리포트
```
=== Download Report ===
Total: 5
Success: 5
Failed: 0
Downloaded: 2.34 MB
Auto-cleanup: Yes
✓ Cleaned up 5 temporary files
```

## 밴 방지 모범 사례

### 1. 적절한 Worker 수
```powershell
# 소규모 사이트: 1-3 workers
--workers 2

# 대형 API: 5-10 workers
--workers 5

# 테스트: 1 worker
--workers 1
```

### 2. Delay 조정
```rust
// src/main.rs에서 조정
let mut collector = Collector::new(
    "eodi.me-collector/1.0".to_string(),
    2.0,   // 2초 delay로 증가 (보수적)
    60.0,  // max delay
    200,
    10,    // concurrent 줄이기
);
```

### 3. 에러 대응
- **HTTP 429**: Worker 수 줄이기, delay 늘리기
- **HTTP 403**: robots.txt 확인, User-Agent 변경
- **Timeout**: 네트워크 확인, timeout 늘리기

## 디스크 용량 관리

### 자동 정리 (권장)
```powershell
# 처리 완료 시 임시 파일 자동 삭제
cargo run --release -- download-many --file urls.txt --auto-cleanup true
```

### 수동 정리
```powershell
# 임시 디렉토리 전체 삭제
Remove-Item temp\* -Recurse -Force

# 오래된 파일만 삭제 (7일 이상)
Get-ChildItem temp -Recurse | Where-Object {$_.LastWriteTime -lt (Get-Date).AddDays(-7)} | Remove-Item
```

### 모니터링
```powershell
# 임시 디렉토리 크기 확인
Get-ChildItem temp -Recurse | Measure-Object -Property Length -Sum

# 출력 디렉토리 크기
Get-ChildItem output -Recurse | Measure-Object -Property Length -Sum
```

## 로그 레벨 조정

```powershell
# INFO 레벨 (기본)
cargo run --release -- fetch-many --file urls.txt

# DEBUG 레벨 (상세 로그)
$env:RUST_LOG="debug"
cargo run --release -- fetch-many --file urls.txt

# ERROR만 표시
$env:RUST_LOG="error"
cargo run --release -- fetch-many --file urls.txt
```

## 문제 해결

### 1. "Blocked by robots.txt"
```powershell
# robots.txt 확인
cargo run --release -- test-robots --url "https://example.com"

# 해결: 다른 API 사용 또는 robots.txt 허용 경로 사용
```

### 2. "Too Many Requests (429)"
```powershell
# Worker 수 줄이기
--workers 1

# Delay 늘리기 (main.rs 수정 필요)
```

### 3. 디스크 부족
```powershell
# 자동 정리 활성화
--auto-cleanup true

# 임시 파일 수동 삭제
Remove-Item temp\* -Force
```

### 4. 메모리 부족
```powershell
# 스트리밍 다운로드 사용 (download 커맨드)
cargo run --release -- download --url "..." --auto-cleanup true

# fetch 대신 download 사용 (대용량 파일)
```

## 무료 API 데이터 소스

상세 목록은 [FREE_APIS.md](FREE_APIS.md) 참조

- ✅ REST Countries API
- ✅ JSON Placeholder
- ✅ Open-Meteo (날씨)
- ✅ World Bank Open Data
- ✅ Nominatim (OpenStreetMap)
- ✅ IP Geolocation (ipapi.co)

