#!/usr/bin/env python3
"""
duckdb_to_sqlite.py
-------------------
Reads valid cities from the DuckDB collector output, computes 15D vibe vectors,
and writes everything into an SQLite database that the Go API can serve.

Usage:
    python3 scripts/duckdb_to_sqlite.py
"""

import json
import math
import os
import struct
import sqlite3
import statistics
from pathlib import Path

import duckdb

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
PROJECT_ROOT = Path(__file__).resolve().parent.parent
DUCKDB_PATH = PROJECT_ROOT / "rust-collector" / "output" / "cities.db"
SQLITE_PATH = PROJECT_ROOT / "data" / "vibe_data.db"

# ---------------------------------------------------------------------------
# POI category → vibe axis mapping
# ---------------------------------------------------------------------------
VIBE_AXES = {
    "vitality":   ["restaurant", "cafe", "bar", "fast_food", "nightclub"],
    "culture":    ["museum", "theatre", "library", "gallery", "cinema"],
    "relief":     ["park", "garden", "spa"],
    "rhythm":     ["bus_station", "bus_stops", "tram_stops", "rail_stations", "subway_entrances"],
    "lifestyle":  ["gym", "sports_centre", "beauty", "hairdresser"],
    "commercial": ["supermarket", "mall", "shop_generic", "marketplace", "atm"],
}

ALL_POI_KEYS = sorted(
    {k for keys in VIBE_AXES.values() for k in keys}
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _safe(poi: dict, key: str) -> float:
    """Return numeric value or 0 for missing/None keys."""
    v = poi.get(key)
    return float(v) if v is not None else 0.0


def _log_norm(value: float, cap: float = 1.0) -> float:
    """Log-scale normalisation: log(1+x) / log(1+cap), clipped to [0,1]."""
    if value <= 0:
        return 0.0
    return min(math.log1p(value) / math.log1p(cap), 1.0)


def compute_vector(poi: dict, population: int) -> list[float]:
    """Return a 15-dimensional float vector for a city."""

    # --- Axes 0-5: vibe axes, raw sums ---
    axis_raw: list[float] = []
    for axis_name in ["vitality", "culture", "relief", "rhythm", "lifestyle", "commercial"]:
        total = sum(_safe(poi, k) for k in VIBE_AXES[axis_name])
        axis_raw.append(total)

    # We normalise per-axis across the batch later; for a single-pass approach
    # we use log normalisation with reasonable caps.
    axis_caps = [500, 30, 50, 200, 100, 400]
    dims: list[float] = [_log_norm(v, c) for v, c in zip(axis_raw, axis_caps)]

    # dim[6]: total_poi log normalised
    total_poi = _safe(poi, "total_poi")
    dims.append(_log_norm(total_poi, 2000))

    # dim[7]: POI diversity (fraction of non-zero categories)
    non_zero = sum(1 for k in ALL_POI_KEYS if _safe(poi, k) > 0)
    dims.append(non_zero / len(ALL_POI_KEYS) if ALL_POI_KEYS else 0.0)

    # dim[8]: nearest_water_km (inverse, normalised)
    water_km = poi.get("nearest_water_km")
    if water_km is not None and water_km > 0:
        dims.append(min(1.0 / water_km, 1.0))   # closer → higher
    else:
        dims.append(0.5)  # unknown → neutral

    # dim[9]: temporal placeholder
    dims.append(0.5)

    # dim[10]: flow placeholder
    dims.append(0.5)

    # dim[11]: population density estimate (log scale normalised)
    dims.append(_log_norm(float(population), 10_000_000))

    # dim[12]: transit score
    transit = sum(
        _safe(poi, k) for k in ["bus_stops", "tram_stops", "subway_entrances", "rail_stations"]
    )
    dims.append(_log_norm(transit, 300))

    # dim[13]: reserved
    dims.append(0.0)

    # dim[14]: reserved
    dims.append(0.0)

    return dims


def vector_to_blob(vec: list[float]) -> bytes:
    """Pack 15 floats as little-endian float32 → 60 bytes."""
    return struct.pack("<15f", *vec)


def l2sq(a: list[float], b: list[float]) -> float:
    """Squared L2 distance between two vectors."""
    return sum((x - y) ** 2 for x, y in zip(a, b))


def median_5nn_l2sq(vectors: list[list[float]]) -> float:
    """Median of per-city 5-nearest-neighbour L2² distances."""
    n = len(vectors)
    per_city: list[float] = []
    for i in range(n):
        dists = sorted(l2sq(vectors[i], vectors[j]) for j in range(n) if j != i)
        k = min(5, len(dists))
        if k > 0:
            per_city.append(dists[k - 1])  # distance to 5th nearest
    return statistics.median(per_city) if per_city else 0.0


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    # 1. Remove old database
    if SQLITE_PATH.exists():
        SQLITE_PATH.unlink()
        print(f"Removed old {SQLITE_PATH}")

    SQLITE_PATH.parent.mkdir(parents=True, exist_ok=True)

    # 2. Read from DuckDB
    duck = duckdb.connect(str(DUCKDB_PATH), read_only=True)
    rows = duck.execute(
        "SELECT geoname_id, name, ascii_name, latitude, longitude, "
        "country_code, population, timezone, poi_data "
        "FROM cities WHERE is_valid = 1 ORDER BY name"
    ).fetchall()
    duck.close()
    print(f"Read {len(rows)} valid cities from DuckDB")

    # 3. Create SQLite database
    con = sqlite3.connect(str(SQLITE_PATH))
    cur = con.cursor()

    cur.executescript("""
        CREATE TABLE cities (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            ascii_name TEXT,
            country TEXT,
            lat NUMERIC(10,6),
            lon NUMERIC(10,6),
            population BIGINT,
            timezone TEXT,
            feature_code TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE city_vectors (
            city_id TEXT PRIMARY KEY,
            vector BLOB NOT NULL,
            dim INTEGER NOT NULL DEFAULT 15,
            version INTEGER NOT NULL DEFAULT 1,
            created_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE index_metadata (
            id INTEGER PRIMARY KEY,
            median_5nn_l2sq REAL,
            city_count INTEGER,
            built_at TEXT DEFAULT (datetime('now'))
        );
    """)

    # 4. Insert cities and compute vectors
    all_vectors: list[list[float]] = []
    city_ids: list[str] = []

    for row in rows:
        geoname_id, name, ascii_name, lat, lon, country_code, population, tz, poi_json = row
        city_id = str(geoname_id)
        poi = json.loads(poi_json) if poi_json else {}

        vec = compute_vector(poi, population)
        all_vectors.append(vec)
        city_ids.append(city_id)

        cur.execute(
            "INSERT INTO cities (id, name, ascii_name, country, lat, lon, population, timezone) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (city_id, name, ascii_name, country_code, lat, lon, population, tz),
        )
        cur.execute(
            "INSERT INTO city_vectors (city_id, vector, dim, version) VALUES (?, ?, 15, 1)",
            (city_id, vector_to_blob(vec)),
        )

    # 5. Compute index_metadata
    med = median_5nn_l2sq(all_vectors)
    cur.execute(
        "INSERT INTO index_metadata (median_5nn_l2sq, city_count) VALUES (?, ?)",
        (med, len(rows)),
    )
    print(f"median_5nn_l2sq = {med:.6f}  (city_count = {len(rows)})")

    # 6. Create indexes (from go-api/scripts/create-indexes.sql)
    cur.executescript("""
        CREATE INDEX IF NOT EXISTS idx_cities_name         ON cities(name);
        CREATE INDEX IF NOT EXISTS idx_cities_ascii_name   ON cities(ascii_name);
        CREATE INDEX IF NOT EXISTS idx_cities_country      ON cities(country);
        CREATE INDEX IF NOT EXISTS idx_city_vectors_city_id ON city_vectors(city_id);
        CREATE INDEX IF NOT EXISTS idx_metadata_singleton  ON index_metadata(id);
        ANALYZE;
    """)

    con.commit()
    con.close()
    print(f"Created {SQLITE_PATH}  ({SQLITE_PATH.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()
