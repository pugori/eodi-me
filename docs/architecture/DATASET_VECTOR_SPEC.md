# Urban Vibe Dataset v7 — 매칭 벡터 명세서

> **버전**: v7.0 (2026-03)
> **차원**: 13D (고정)
> **유사도 엔진**: Rust 내장 L2 + Gaussian RBF
> **커널**: Gaussian RBF — `similarity = exp(-L2² / σ²) × 100`

---

## 1. 벡터 구조 총람

```
┌─────────────────────────────────────────────────────────────────┐
│  13차원 매칭 벡터 (Matching Vector)                              │
├─────┬──────────────────────────┬────────┬───────────────────────┤
│ Dim │ 필드명                    │ 범위   │ 데이터 소스            │
├─────┼──────────────────────────┼────────┼───────────────────────┤
│  0  │ vitality                 │ 0.0–1.0│ Urban Vibe (POI)      │
│  1  │ culture                  │ 0.0–1.0│ Urban Vibe (POI)      │
│  2  │ relief                   │ 0.0–1.0│ Urban Vibe (POI)      │
│  3  │ rhythm                   │ 0.0–1.0│ Urban Vibe (POI)      │
│  4  │ lifestyle                │ 0.0–1.0│ Urban Vibe (POI)      │
│  5  │ commercial               │ 0.0–1.0│ Urban Vibe (POI)      │
│  6  │ poi_density_norm         │ 0.0–1.0│ Overture Places       │
│  7  │ category_diversity_norm  │ 0.0–1.0│ Overture Places       │
│  8  │ water_proximity_norm     │ 0.0–1.0│ OSM / Overture        │
│  9  │ temporal_entropy_norm    │ 0.0–1.0│ WorldMove / Fallback  │
│ 10  │ flow_to_poi_ratio_norm   │ 0.0–1.0│ Kontur+POI / Fallback │
│ 11  │ population_density_norm  │ 0.0–1.0│ Kontur H3 / Fallback  │
│ 12  │ transit_accessibility_norm│0.0–1.0│ GTFS / Fallback       │
└─────┴──────────────────────────┴────────┴───────────────────────┘
```

---

## 2. 차원별 상세 정의

### Layer A: Urban Vibe 6축 (dim 0–5)

POI 카테고리 분포에서 동네의 "분위기"를 수치화한 핵심 축.

| Dim | 축 | 계산 방식 | POI 카테고리 |
|-----|-----|----------|--------------|
| 0 | **Vitality** (활력) | 음식점·카페·술집 밀도 | restaurant, cafe, bar, fast_food |
| 1 | **Culture** (문화) | 문화·예술·교육 시설 비율 | museum, theatre, library, gallery |
| 2 | **Relief** (여유) | 공원·자연·헬스 공간 비율 | park, garden, sports_centre, spa |
| 3 | **Rhythm** (리듬) | 교통·인프라·야간 비율 | bus_station, atm, nightclub, cinema |
| 4 | **Lifestyle** (라이프) | 카페·쇼핑·미용 비율 | cafe, beauty, hairdresser, gym |
| 5 | **Commercial** (상업) | 소매·마켓·쇼핑몰 비율 | supermarket, mall, shop, marketplace |

**정규화**: 반경 내 카테고리별 POI 비율 (0.0–1.0)

### Layer B: POI 프로필 (dim 6–7)

| Dim | 필드 | 정의 |
|-----|------|------|
| 6 | **poi_density_norm** | 반경 내 총 POI 수 → 국가 내 percentile 정규화 |
| 7 | **category_diversity_norm** | Shannon entropy of POI categories → 정규화 |

### Layer C: 환경 (dim 8)

| Dim | 필드 | 정의 |
|-----|------|------|
| 8 | **water_proximity_norm** | 가장 가까운 수체(river/lake/sea)까지 거리 역수 정규화 |

### Layer D: 모빌리티 (dim 9–10)

| Dim | 필드 | 1차 소스 | 정의 |
|-----|------|---------|------|
| 9 | **temporal_entropy_norm** | WorldMove 합성 이동 | 24시간 활동 균등도 (Shannon entropy). 높을수록 = 밤낮 없이 활발 |
| 10 | **flow_to_poi_ratio_norm** | Kontur × POI | (유동인구 / POI 수) 정규화. 높을수록 = 상점이 적은데 사람은 많은 곳 |

### Layer E: 인구·교통 (dim 11–12)

| Dim | 필드 | 1차 소스 | 정의 |
|-----|------|---------|------|
| 11 | **population_density_norm** | Kontur H3 (Res 8, ~400m) | 반경 1.5km 내 H3 hexagon 인구 합 / 면적 → percentile |
| 12 | **transit_accessibility_norm** | GTFS | 도보 800m 내 정류장 (운행수 × 모드가중치 × 거리감쇠) → percentile |

---

## 3. Fallback 전략 (항상 13D 보장)

모빌리티·인구·교통 데이터가 없는 국가에서도 벡터 차원 일관성을 위해
**POI 프로필에서 추정**하여 0.5 중립값 대신 유의미한 값을 채운다.

```
┌──────────┬────────────────────────────────────────────────┬──────────┐
│ Dim      │ Fallback 공식                                  │ 근거     │
├──────────┼────────────────────────────────────────────────┼──────────┤
│  9 (TE)  │ cat_diversity × 0.6 + poi_density × 0.3 + 0.05│ 다양한 POI│
│          │                                                │ = 다양한  │
│          │                                                │ 시간대활동│
├──────────┼────────────────────────────────────────────────┼──────────┤
│ 10 (FPR) │ poi_density × 0.5 + cat_diversity × 0.3 + 0.1 │ POI밀도  │
│          │                                                │ ≈유동비율 │
├──────────┼────────────────────────────────────────────────┼──────────┤
│ 11 (PD)  │ poi_density × 0.7 + 0.15                      │ POI多=   │
│          │                                                │ 인구多   │
├──────────┼────────────────────────────────────────────────┼──────────┤
│ 12 (TA)  │ rhythm × 0.5 + poi_density × 0.3 + 0.1        │ 리듬≈    │
│          │                                                │ 교통접근성│
└──────────┴────────────────────────────────────────────────┴──────────┘
```

**학술 근거**: Cranshaw et al. (2012) "Livehoods" — POI 다양성은 시간대별 활동 다양성의 프록시.

---

## 4. 레이더 차트 매핑 (13D → 6축)

매칭 벡터의 13차원을 시각화·해석을 위해 6축 레이더로 함축.

```
    Vitality
       ╲
        ╲         Culture
         ●───────────●
        ╱ ╲         ╱
       ╱   ╲       ╱
Commercial  Relief
       ╲   ╱       ╲
        ╲ ╱         ╲
         ●───────────●
        ╱         ╱
       ╱         ╱
   Lifestyle   Rhythm
```

| 레이더 축 | 벡터 차원 합성 | 가중치 |
|-----------|---------------|--------|
| **Vitality** | vibe.vitality × 0.50 + poi_density × 0.15 + **pop_density × 0.20** + flow_to_poi × 0.15 | Σ = 1.0 |
| **Culture** | vibe.culture × 0.80 + cat_diversity × 0.20 | Σ = 1.0 |
| **Relief** | vibe.relief × 0.60 + water × 0.40 | Σ = 1.0 |
| **Rhythm** | vibe.rhythm × 0.45 + **temporal_entropy × 0.40** + **transit × 0.15** | Σ = 1.0 |
| **Lifestyle** | vibe.lifestyle × 0.70 + cat_diversity × 0.30 | Σ = 1.0 |
| **Commercial** | vibe.commercial × 0.80 + poi_density × 0.20 | Σ = 1.0 |

**굵은 글씨** = 모빌리티 데이터 통합 차원 (Kontur/GTFS/WorldMove)

---

## 5. 유사도 계산

### 5.1 거리 메트릭

```
distance = L2²(vecA, vecB) = Σᵢ (vecA[i] - vecB[i])²
```

### 5.2 Gaussian RBF 커널

```
similarity(%) = exp(-L2² / σ²) × 100
```

### 5.3 σ² 자동 보정

데이터 분포에 맞게 자동 계산하여 매칭 품질 일정하게 유지:

```
σ² = median(5th-NN L2²) / ln(2)
```

| 목표 | 유사도 범위 |
|------|------------|
| #1 매칭 | 75–95% |
| #5 매칭 | ~50% (기준점) |
| #10 매칭 | 15–35% |

### 5.4 검색 엔진

| 규모 | FAISS 인덱스 | 파라미터 |
|------|-------------|---------|
| < 10,000 벡터 | `IndexFlatL2` | 정확한 전수 탐색 |
| ≥ 10,000 벡터 | `IndexIVFFlat` | nlist=√N, nprobe=√nlist |

---

## 6. 도로 장벽 + 대중교통 브리지 시스템

매칭은 아니지만 **동네 경계 정의**에 사용되는 물리적 장벽 시스템.

### 6.1 장벽 강도 (Appleyard, 1981)

| 도로 등급 | 밀도 억제율 | 근거 |
|-----------|-----------|------|
| Motorway (고속도로) | 95% | 보행 불가 |
| Trunk (간선 6-8차로) | 85% | 심리적 분리 |
| Primary (4-6차로) | 60% | 부분 분리 |

### 6.2 대중교통 브리지 (장벽 약화)

```
effective_barrier = raw_barrier × (1 - bridge_strength × freq_factor)
```

#### 기본 브리지 강도 (모드별)

| 모드 | bridge_strength | 근거 |
|------|----------------|------|
| Subway | 1.0 | 지하 통과 — 완전 관통 |
| Rail | 0.9 | 입체교차 |
| Monorail | 0.8 | 입체교차 |
| Ferry | 0.7 | 수상 장벽 관통 |
| Tram | 0.6 | 부분 관통 |
| Cable Tram | 0.5 | 공중 이동 |
| Aerial Lift | 0.5 | 공중 이동 |
| Funicular | 0.4 | 제한적 연결 |
| Bus | 0.3 | 도로 위 — 약한 연결 |
| Trolleybus | 0.3 | 도로 위 — 약한 연결 |

#### 운행 빈도 가중치 (freq_factor)

> "자주 오는 지하철이 동네를 더 잘 연결한다"

| 양쪽 최소 운행 횟수 (/일) | freq_factor |
|--------------------------|-------------|
| ≥ 200회 (지하철급) | × 1.00 |
| 100–199회 | × 0.85 |
| 50–99회 | × 0.70 |
| < 50회 (인적 드문 노선) | × 0.50 |

**예시**: 서울의 motorway, 양쪽 지하철역 150회/일 운행
```
effective = 0.95 × (1 - 1.0 × 0.85) = 0.95 × 0.15 = 0.1425
→ 장벽 95% → 14.3% (사실상 관통)
```

---

## 7. 데이터 소스 및 라이선스

| 소스 | 용도 | 차원 | 라이선스 |
|------|------|------|---------|
| Overture Maps Places | POI 수집 (6축 Vibe, 밀도, 다양성) | 0–7 | CDLA-P 2.0 |
| OpenStreetMap | POI·수체·도로 장벽 | 0–8 | ODbL 1.0 |
| WorldMove | 합성 이동 패턴 (24h entropy) | 9 | CC BY 4.0 |
| Kontur Population | H3 인구 밀도 (Res 8, ~400m) | 10–11 | CC BY 4.0 |
| GTFS Transit | 대중교통 접근성·브리지 | 12 | 기관별 (대부분 Open) |
| Overture Transportation | 도로 장벽 래스터화 | 경계 정의 | CDLA-P 2.0 |

---

## 8. 벡터 예시

### 서울 연남동 (가상)

```json
{
  "vector": [
    0.8456,  // 0: vitality    — 음식점·카페 밀집
    0.3200,  // 1: culture     — 갤러리·독립서점 일부
    0.1567,  // 2: relief      — 경의선숲길
    0.7973,  // 3: rhythm      — 홍대 야간 활성
    0.6265,  // 4: lifestyle   — 카페·미용·편집숍
    0.4233,  // 5: commercial  — 소규모 상점 위주
    0.7120,  // 6: poi_density — 높은 POI 밀도
    0.6840,  // 7: cat_diversity — 다양한 카테고리
    0.2100,  // 8: water       — 수변 접근 보통
    0.7340,  // 9: temporal_entropy — 밤낮 고루 활발
    0.5890,  // 10: flow_to_poi — 유동/POI 비율
    0.8210,  // 11: pop_density — 높은 인구
    0.9100   // 12: transit    — 지하철 2·경의선 접근
  ]
}
```

---

## 9. 버전 히스토리

| 버전 | 날짜 | 변경 |
|------|------|------|
| v1.0 | 2025-01 | 초기 5D |
| v4.0 | 2025-08 | 9D (mobility 추가) |
| v6.0 | 2026-02 | 15D (기후 dim 9–10 추가, 모빌리티 dim 11–14) |
| **v7.0** | **2026-03** | **13D — 기후 데이터(dim 9–10) 제거. 상권 분석 B2B 방향 전환에 따라 기후 무관성 확인 후 제거. 수집 시간 12–16x 단축** |

