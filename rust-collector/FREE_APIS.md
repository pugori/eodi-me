# EODI.ME Data Collector - 무료 API 가이드

## 🌍 지리/도시 정보 API (무료, API 키 불필요)

### 1. REST Countries API
**URL**: `https://restcountries.com/v3.1/`
**Rate Limit**: 없음 (합리적 사용 요청)
**데이터**: 국가, 수도, 인구, 언어, 통화 등

```bash
# 수도로 검색
cargo run --release -- fetch --url "https://restcountries.com/v3.1/capital/Seoul"

# 국가명으로 검색
cargo run --release -- fetch --url "https://restcountries.com/v3.1/name/Korea"

# 지역별
cargo run --release -- fetch --url "https://restcountries.com/v3.1/region/Asia"
```

### 2. Nominatim (OpenStreetMap)
**URL**: `https://nominatim.openstreetmap.org/`
**Rate Limit**: 1 req/sec (User-Agent 필수)
**데이터**: 지리 좌표, 주소, 경계

```bash
# 도시 검색
cargo run --release -- fetch --url "https://nominatim.openstreetmap.org/search?city=Seoul&format=json"

# 역 지오코딩
cargo run --release -- fetch --url "https://nominatim.openstreetmap.org/reverse?lat=37.5665&lon=126.9780&format=json"
```

### 3. IP Geolocation (ipapi.co)
**URL**: `https://ipapi.co/`
**Rate Limit**: 1,000 req/day (무료)
**데이터**: IP 기반 위치

```bash
cargo run --release -- fetch --url "https://ipapi.co/json/"
```

## 📊 공공 데이터 API

### 4. World Bank Open Data
**URL**: `https://api.worldbank.org/v2/`
**Rate Limit**: 없음
**데이터**: 경제, 인구, 개발 지표

```bash
# 국가별 인구
cargo run --release -- fetch --url "https://api.worldbank.org/v2/country/KR/indicator/SP.POP.TOTL?format=json"
```

### 5. Open-Meteo (날씨)
**URL**: `https://api.open-meteo.com/v1/`
**Rate Limit**: 10,000 req/day
**데이터**: 날씨, 기후 데이터

```bash
# 서울 날씨
cargo run --release -- fetch --url "https://api.open-meteo.com/v1/forecast?latitude=37.5665&longitude=126.9780&current_weather=true"
```

### 6. JSON Placeholder (테스트용)
**URL**: `https://jsonplaceholder.typicode.com/`
**Rate Limit**: 없음
**데이터**: 테스트 데이터

```bash
cargo run --release -- fetch --url "https://jsonplaceholder.typicode.com/posts"
```

## 📁 샘플 URL 파일

### urls_free_apis.txt (무료 API 모음)
```txt
# REST Countries - 아시아 국가들
https://restcountries.com/v3.1/capital/Seoul
https://restcountries.com/v3.1/capital/Tokyo
https://restcountries.com/v3.1/capital/Beijing
https://restcountries.com/v3.1/capital/Bangkok
https://restcountries.com/v3.1/capital/Singapore

# Nominatim - 주요 도시
https://nominatim.openstreetmap.org/search?city=Seoul&format=json
https://nominatim.openstreetmap.org/search?city=Tokyo&format=json
https://nominatim.openstreetmap.org/search?city=London&format=json
https://nominatim.openstreetmap.org/search?city=Paris&format=json
https://nominatim.openstreetmap.org/search?city=New York&format=json

# World Bank - 인구 데이터
https://api.worldbank.org/v2/country/KR/indicator/SP.POP.TOTL?format=json
https://api.worldbank.org/v2/country/JP/indicator/SP.POP.TOTL?format=json
https://api.worldbank.org/v2/country/US/indicator/SP.POP.TOTL?format=json

# Open-Meteo - 날씨
https://api.open-meteo.com/v1/forecast?latitude=37.5665&longitude=126.9780&current_weather=true
https://api.open-meteo.com/v1/forecast?latitude=35.6762&longitude=139.6503&current_weather=true
```

## 🚀 실행 예제

### 1. 단일 API 호출 (밴 방지 적용)
```bash
# robots.txt 자동 체크, rate limiting 적용
cargo run --release -- fetch --url "https://restcountries.com/v3.1/capital/Seoul"
```

### 2. 여러 API 동시 호출 (Worker 제한)
```bash
# 5개 워커로 병렬 수집 (과부하 방지)
cargo run --release -- fetch-many --file urls_free_apis.txt --workers 5
```

### 3. 파일 다운로드 (자동 정리)
```bash
# 다운로드 후 처리 완료 시 자동 삭제
cargo run --release -- download --url "https://example.com/data.json" --auto-cleanup true
```

### 4. 대량 파일 다운로드
```bash
# 여러 파일 다운로드, 처리 후 자동 삭제로 디스크 절약
cargo run --release -- download-many --file urls_download.txt --workers 3 --auto-cleanup true
```

## ⚙️ 밴 방지 설정 (이미 적용됨)

### 1. Robots.txt 준수
- 자동으로 `/robots.txt` 확인
- Disallow된 경로는 수집하지 않음
- Crawl-delay 자동 적용

### 2. Rate Limiting
- 도메인별 요청 속도 제한
- 기본 1초 delay
- Exponential backoff 재시도

### 3. User-Agent 설정
```rust
// src/main.rs에서 설정됨
"eodi.me-collector/1.0"
```

### 4. Timeout 설정
- 기본 30초 timeout
- 응답 없으면 자동 실패 처리

### 5. Concurrent Workers 제한
- 최대 20개 동시 연결 (기본값)
- 서버 부하 최소화

## 📝 권장 사항

### API 선택 기준
1. ✅ **무료 API 우선**: API 키 불필요
2. ✅ **Rate Limit 확인**: 요청 제한 준수
3. ✅ **robots.txt 체크**: 봇 허용 여부 확인
4. ✅ **데이터 라이선스**: 상업적 사용 가능 여부

### 수집 전략
1. **소량 테스트**: 먼저 1-5개 URL로 테스트
2. **Worker 조절**: 서버 응답 속도에 맞춰 조정
3. **에러 핸들링**: 실패 시 재시도 로직 확인
4. **디스크 관리**: auto-cleanup으로 공간 절약

### 디스크 용량 관리
```bash
# 임시 파일 자동 삭제 (권장)
--auto-cleanup true

# 임시 디렉토리 지정
--temp-dir ./temp_downloads

# 처리 완료 후 output만 남김
# temp 폴더는 자동으로 비워짐
```

## 🔒 법적 준수 사항

### 해야 할 것
- ✅ robots.txt 준수
- ✅ 공개 API만 사용
- ✅ Rate limit 지키기
- ✅ 적절한 User-Agent 설정
- ✅ 서비스 약관(ToS) 확인

### 하지 말아야 할 것
- ❌ API 키 필요한데 무단 사용
- ❌ Rate limit 무시하고 과도한 요청
- ❌ robots.txt Disallow 무시
- ❌ 개인정보 무단 수집
- ❌ DDoS 형태의 공격적 수집

## 📞 문제 발생 시

### HTTP 429 (Too Many Requests)
```bash
# Worker 수 줄이기
--workers 1

# Delay 늘리기 (src/main.rs에서 조정)
default_delay_secs: 2.0  # 1.0에서 2.0으로
```

### HTTP 403 (Forbidden)
- robots.txt 확인
- User-Agent 변경 필요 여부 체크
- API 키 필요 여부 확인

### 디스크 부족
```bash
# 자동 정리 활성화
--auto-cleanup true

# 임시 파일 수동 삭제
Remove-Item temp\* -Recurse -Force
```
