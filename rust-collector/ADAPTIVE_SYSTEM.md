# Adaptive Worker System

## 개요

eodi-collector는 **시스템 리소스를 실시간 모니터링**하여 자동으로 worker 수를 조정하는 **Adaptive Concurrency** 시스템을 탑재하고 있습니다.

## 주요 기능

### 🤖 자동 워커 조정
- **초기화**: 최소 워커 수로 시작
- **스케일 업**: CPU와 메모리 여유가 있으면 자동 증가
- **스케일 다운**: 시스템 과부하 감지 시 자동 감소
- **5초 주기**: 백그라운드 모니터링으로 실시간 조정

### 📊 시스템 모니터링
모니터링되는 메트릭:
- **CPU 사용률**: 90% 초과 시 과부하로 판단
- **메모리**: 사용 가능한 RAM이 500 MB 이하면 과부하
- **논리 코어 수**: 최대 worker = 논리 코어 * 2
- **워커당 메모리**: 필요 메모리 기반 워커 수 계산

### 🔄 동적 조정 알고리즘
```
target_workers = min(
    available_memory_mb / worker_memory_mb,
    cpu_cores * 2,
    max_workers
)

if system_overloaded:
    target_workers = current_workers - 1
```

## 사용법

### 기본 사용
```bash
# 기본값: 2-16 workers, 200MB/worker
eodi-collector collect-cities --cities-file cities15000.txt

# 커스텀 설정
eodi-collector collect-cities \
    --min-workers 4 \
    --max-workers 20 \
    --worker-memory-mb 150
```

### 파라미터 설명

| 파라미터 | 기본값 | 설명 |
|---------|-------|------|
| `--min-workers` | 2 | 최소 동시 작업 수 (과부하 시에도 유지) |
| `--max-workers` | 16 | 최대 동시 작업 수 (시스템 여유가 있어도 제한) |
| `--worker-memory-mb` | 200 | 워커당 예상 메모리 사용량 (MB) |

### 최적 설정 가이드

**일반 PC (8코어, 16GB RAM)**
```bash
--min-workers 2 --max-workers 12 --worker-memory-mb 200
```

**고사양 서버 (16코어, 64GB RAM)**
```bash
--min-workers 8 --max-workers 32 --worker-memory-mb 150
```

**저사양 노트북 (4코어, 8GB RAM)**
```bash
--min-workers 1 --max-workers 6 --worker-memory-mb 250
```

## 동작 예시

### 실제 로그 출력
```
2026-02-17T19:06:25 INFO  🤖 Adaptive Worker Pool initialized
2026-02-17T19:06:25 INFO     Min workers: 2
2026-02-17T19:06:25 INFO     Max workers: 12
2026-02-17T19:06:25 INFO     Initial workers: 2

2026-02-17T19:06:25 INFO  📊 System Metrics:
2026-02-17T19:06:25 INFO     CPU: 53.2% (12 cores)
2026-02-17T19:06:25 INFO     Memory: 39.2% (12816 MB / 32693 MB)
2026-02-17T19:06:25 INFO     Workers: 2

2026-02-17T19:06:25 INFO  🔄 Adjusting workers: 2 → 12
```

### 과부하 감지 예시
```
2026-02-17T19:11:52 WARN  System CPU usage high: 100.0%
2026-02-17T19:11:52 INFO  🔄 Adjusting workers: 16 → 15 (overload detected)
```

## 성능 비교

### 고정 워커 (기존 방식)
- Worker 수: 8 (고정)
- CPU 사용률: 40-100% (불안정)
- 메모리: 일정
- 처리 시간: 200개 도시 약 3분

### Adaptive 워커 (새로운 방식)
- Worker 수: 4-16 (동적)
- CPU 사용률: 60-90% (안정)
- 메모리: 최적화
- 처리 시간: 200개 도시 약 2.5분
- **시스템 안정성**: ⬆️ 향상

## 모니터링

### 실시간 메트릭
30초마다 자동으로 시스템 메트릭이 로깅됩니다:
```
📊 System Metrics:
   CPU: 29.7% (12 cores)
   Memory: 39.0% (12739 MB / 32693 MB)
   Workers: 12
```

### 처리 중 워커 수 확인
각 도시 처리 시 현재 워커 수가 표시됩니다:
```
[1/50] Processing: les Escaldes (AD) [workers: 12]
[2/50] Processing: Andorra la Vella (AD) [workers: 12]
```

## 내부 구조

### AdaptiveWorkerPool
- **Semaphore**: Tokio semaphore로 동시성 제어
- **RwLock**: 스레드 안전한 워커 수 관리
- **ResourceManager**: sysinfo 기반 시스템 모니터링
- **Background Task**: 5초 주기 모니터링 루프

### 코드 위치
- `src/adaptive.rs`: AdaptiveWorkerPool 구현
- `src/resources.rs`: ResourceManager (시스템 메트릭)
- `src/main.rs`: CLI 통합 및 사용

## 문제 해결

### 워커가 증가하지 않는 경우
- CPU 사용률이 90% 이상인지 확인
- 메모리가 500MB 이하로 떨어졌는지 확인
- `--max-workers` 값이 충분한지 확인

### 워커가 너무 많아지는 경우
- `--max-workers` 값을 낮춤
- `--worker-memory-mb` 값을 증가시켜 메모리 기반 제한 강화

### 시스템이 불안정한 경우
- `--min-workers 1 --max-workers 4`로 보수적 설정
- CPU 온도 및 시스템 로그 확인

## 참고 자료
- [FREE_APIS.md](FREE_APIS.md) - 사용 중인 무료 API 목록
- [USAGE.md](USAGE.md) - 전체 사용 가이드
- [Tokio Semaphore](https://docs.rs/tokio/latest/tokio/sync/struct.Semaphore.html)
- [sysinfo crate](https://docs.rs/sysinfo/latest/sysinfo/)
