# BYOD Data Schema Guide — eodi.me Enterprise

> **Tier**: Enterprise ($249/mo)  
> **Feature**: Bring Your Own Data (BYOD) — custom POI and vector integration

---

## Overview

Enterprise customers can augment or replace the built-in OSM/climate data with their own proprietary datasets. This allows use cases such as:

- **Franchise site selection** with internal store performance data
- **Real estate** with internal transaction/rental price layers
- **Retail intelligence** with proprietary foot traffic metrics
- **Urban planning** with municipal survey data

BYOD operates in two modes:

| Mode | What It Does | API |
|------|-------------|-----|
| **POI Overlay** | Adds custom POI counts to existing hexagons | `PUT /user/hex/:h3` |
| **Custom Schema** | Full custom 15D vector per hexagon (Enterprise only) | Coming in v1.1 |

---

## Mode 1: POI Overlay (Solo Biz+)

Replace or augment the 6 Urban Vibe axes with your own data.

### Endpoint

```
PUT /user/hex/{h3_index}
Authorization: Bearer {api_key}
Content-Type: application/json
```

### Schema

```json
{
  "poi_counts": [vitality, culture, relief, rhythm, lifestyle, commercial, total]
}
```

| Index | Axis | Description | Example data |
|-------|------|-------------|-------------|
| 0 | `vitality` | Active & nightlife POIs | Bars, nightclubs, gyms, sports |
| 1 | `culture` | Arts & cultural POIs | Museums, galleries, theaters |
| 2 | `relief` | Health & wellness POIs | Parks, spas, meditation, nature |
| 3 | `rhythm` | Daily rhythm POIs | Coffee, restaurants, fast food |
| 4 | `lifestyle` | Lifestyle & outdoor POIs | Hiking, beaches, markets |
| 5 | `commercial` | Shopping & commercial | Malls, shops, services |
| 6 | `total` | Sum of all POIs | Must equal sum(0..5) or higher |

> **Important**: `poi_counts[6]` (total) must be ≥ sum of indices 0–5. If set to 0, the system falls back to pre-computed vector data.

### Example (Python)

```python
import requests

BASE_URL = "http://127.0.0.1:7557"  # local desktop mode
API_KEY = "your_api_key_from_settings"

# Get h3_index from /hex/nearest or /hex/search first
h3_index = "617700169"

response = requests.put(
    f"{BASE_URL}/user/hex/{h3_index}",
    headers={"Authorization": f"Bearer {API_KEY}"},
    json={
        "poi_counts": [
            15,   # vitality: bars, gyms
            8,    # culture: galleries
            5,    # relief: parks
            30,   # rhythm: restaurants
            3,    # lifestyle: markets
            25,   # commercial: shops
            86    # total
        ]
    }
)
data = response.json()
print(data["merged_radar"])  # → {"active": 0.17, "classic": 0.09, ...}
```

### Bulk Upload

For large datasets, use the bulk endpoint (max 1,000 items per request):

```
POST /user/hexagons/bulk
```

```json
{
  "items": [
    { "h3_index": "617700169", "poi_counts": [15, 8, 5, 30, 3, 25, 86] },
    { "h3_index": "617700170", "poi_counts": [2, 20, 15, 10, 8, 5, 60] }
  ]
}
```

### CSV Import Script

```python
import csv, requests

BASE_URL = "http://127.0.0.1:7557"
API_KEY = "your_api_key"

# Expected CSV columns: h3_index, vitality, culture, relief, rhythm, lifestyle, commercial
with open("my_data.csv") as f:
    reader = csv.DictReader(f)
    items = []
    for row in reader:
        counts = [
            int(row["vitality"]), int(row["culture"]), int(row["relief"]),
            int(row["rhythm"]), int(row["lifestyle"]), int(row["commercial"]),
        ]
        counts.append(sum(counts))  # total
        items.append({"h3_index": row["h3_index"], "poi_counts": counts})

    # Upload in batches of 500
    for i in range(0, len(items), 500):
        batch = items[i:i+500]
        resp = requests.post(
            f"{BASE_URL}/user/hexagons/bulk",
            headers={"Authorization": f"Bearer {API_KEY}"},
            json={"items": batch}
        )
        print(f"Batch {i//500+1}: {resp.json()['applied']} applied")
```

---

## Mode 2: Batch Analysis (Business+)

Run analysis on multiple hexagons in a single API call.

### Endpoint

```
POST /batch/analyze
Authorization: Bearer {api_key}
Content-Type: application/json
```

### Schema

```json
{
  "h3_indices": ["617700169", "617700170", ...],
  "include_vector": false
}
```

- `h3_indices`: List of H3 index strings (max 100 per request)
- `include_vector`: Include raw 15D vector in response (default `false`)

### Response

```json
{
  "count": 2,
  "results": [
    {
      "h3_index": "617700169",
      "admin_name": "Hongdae",
      "admin_level": 3,
      "lat": 37.5563,
      "lon": 126.9239,
      "country": "KR",
      "city": "Seoul",
      "has_user_data": false,
      "radar": {
        "active": 0.72,
        "classic": 0.31,
        "quiet": 0.15,
        "trendy": 0.85,
        "nature": 0.12,
        "urban": 0.90
      }
    },
    {
      "h3_index": "617700170",
      "error": "not_found"
    }
  ]
}
```

---

## Finding H3 Indices for Your Locations

Use the Nearest Hexagon API to convert lat/lon coordinates to H3 indices:

```python
response = requests.get(
    f"{BASE_URL}/hex/nearest",
    headers={"Authorization": f"Bearer {API_KEY}"},
    params={"lat": 37.5563, "lon": 126.9239, "k": 1}
)
h3_index = response.json()["hexagons"][0]["h3_index"]
```

---

## Data Persistence

- User overlay data is stored in `{data_dir}/overlays/` (separate from the encrypted VDB)
- Overlays **survive app restarts** — they are not session-scoped
- To reset: `DELETE /user/clear` or use "Reset Data" in Settings

---

## Rate Limits

| Plan | Batch requests/min | Bulk items/request |
|------|------------------|--------------------|
| Business | 60 | 100 (batch) / 1,000 (bulk) |
| Enterprise | 300 | 100 (batch) / 1,000 (bulk) |

---

## Custom Schema (Enterprise — Coming v1.1)

Full custom 15D vector support will allow replacing all pre-computed dimensions with proprietary data. Contact enterprise@eodi.me for early access.
