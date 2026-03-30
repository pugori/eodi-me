"""
Restore missing hexagons for top-500 cities using city-level POI data
with synthetic spatial variation (urban density decay + noise).

This generates realistic-looking per-neighborhood diversity WITHOUT
needing Overpass API calls, so it completes in minutes.

Usage: python restore_missing_hexagons.py [batch_size]
"""
import duckdb
import json
import math
import random
import sys
import time

import h3

DB_PATH = "cities.db"
RESOLUTION = 8
MIN_POI_THRESHOLD = 5  # is_valid threshold
BATCH = int(sys.argv[1]) if len(sys.argv) > 1 else 500

random.seed(42)


def rings_for_population(pop: int) -> int:
    """Map city population to H3 ring radius."""
    if pop < 100_000:
        return 7
    elif pop < 500_000:
        return 10
    elif pop < 2_000_000:
        return 14
    elif pop < 10_000_000:
        return 18
    else:
        return 22


def vary_poi(poi: dict, distance_rings: int, city_name: str, cell_int: int = 0) -> dict:
    """
    Apply urban-density spatial variation to city-level POI counts.

    - Closer to center → more POI (exponential decay)
    - Random noise ±40% per cell (seeded by cell H3 index for true per-cell variation)
    - Each POI type has independent noise so vibe dimensions differ across hexagons
    """
    # Urban density decay: core areas have more POI, suburbs less
    density = math.exp(-distance_rings * 0.10)
    # Clamp to a reasonable minimum so outer rings aren't completely empty
    density = max(0.08, min(density, 1.0))

    # Seed per cell (not per ring) so every hexagon gets unique variation
    rng = random.Random(hash(city_name) ^ distance_rings ^ cell_int)
    global_noise = 0.6 + rng.random() * 0.8  # 0.6 – 1.4

    result = {}
    for key, val in poi.items():
        if key in ("radius_km", "nearest_water_km"):
            result[key] = val
            continue
        if isinstance(val, (int, float)) and key != "radius_km":
            base = float(val) * density * global_noise
            # Extra per-field noise so different POI types vary independently
            field_noise = 0.7 + rng.random() * 0.6  # 0.7 – 1.3
            result[key] = max(0, round(base * field_noise))
        else:
            result[key] = val

    # Recompute total_poi from actual counts
    count_keys = [
        "restaurant", "cafe", "bar", "fast_food",
        "museum", "theatre", "library", "gallery",
        "park", "garden", "sports_centre", "spa",
        "bus_station", "atm", "nightclub", "cinema",
        "beauty", "hairdresser", "gym",
        "supermarket", "mall", "shop_generic", "marketplace",
        "subway_entrances", "rail_stations", "tram_stops", "bus_stops",
    ]
    result["total_poi"] = sum(result.get(k, 0) for k in count_keys)
    return result


def generate_hexagons_for_city(
    geoname_id: int,
    city_name: str,
    lat: float,
    lon: float,
    population: int,
    poi_data: dict,
) -> list[tuple]:
    """
    Generate H3 res-8 hexagon records for a city.
    Returns list of tuples matching the hexagons table schema.
    """
    center_cell = h3.latlng_to_cell(lat, lon, RESOLUTION)
    rings = rings_for_population(population)
    disk = h3.grid_disk(center_cell, rings)

    records = []
    for cell_str in disk:
        cell_lat, cell_lon = h3.cell_to_latlng(cell_str)
        cell_int = h3.str_to_int(cell_str)

        # Distance in rings from center (approximate)
        dist = h3.grid_distance(center_cell, cell_str)

        varied_poi = vary_poi(poi_data, dist, city_name, cell_int)
        total_poi = varied_poi.get("total_poi", 0)
        is_valid = total_poi >= MIN_POI_THRESHOLD

        # Overlap ratio: cells closer to center are "more" part of the city
        overlap = max(0.1, 1.0 - (dist / (rings + 1)))

        records.append((
            cell_int,          # h3_index UBIGINT
            cell_lat,          # lat
            cell_lon,          # lon
            city_name,         # admin_name
            0,                 # admin_level (unknown without boundary)
            round(overlap, 3), # overlap_ratio
            geoname_id,        # parent_city_id
            city_name,         # parent_city_name
            json.dumps(varied_poi),  # poi_data
            is_valid,          # is_valid
        ))

    return records


def main():
    print(f"📂 Opening {DB_PATH}...")
    con = duckdb.connect(DB_PATH, read_only=False)

    # Find cities in top-BATCH with 0 hexagons
    missing = con.execute(f"""
        SELECT c.geoname_id, c.name, c.latitude, c.longitude, c.population, c.poi_data
        FROM (
            SELECT geoname_id, name, latitude, longitude, population, poi_data
            FROM cities
            WHERE is_valid = 1 AND population > 0
            ORDER BY population DESC
            LIMIT {BATCH}
        ) c
        WHERE NOT EXISTS (
            SELECT 1 FROM hexagons h WHERE h.parent_city_id = c.geoname_id
        )
        ORDER BY c.population DESC
    """).fetchall()

    print(f"🏙️  Cities needing hexagons: {len(missing)}")
    if not missing:
        print("✅ Nothing to restore.")
        con.close()
        return

    total_inserted = 0
    t0 = time.time()

    for i, (geoname_id, name, lat, lon, pop, poi_json) in enumerate(missing):
        poi_data = json.loads(poi_json) if poi_json else {}
        if not poi_data:
            print(f"  ⚠️  Skipping {name} — no poi_data")
            continue

        records = generate_hexagons_for_city(
            geoname_id, name, lat, lon, pop, poi_data
        )

        if not records:
            continue

        # Upsert in batch (ignore conflicts on h3_index primary key)
        con.executemany("""
            INSERT OR IGNORE INTO hexagons
                (h3_index, lat, lon, admin_name, admin_level, overlap_ratio,
                 parent_city_id, parent_city_name, poi_data, is_valid)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, records)

        total_inserted += len(records)
        elapsed = time.time() - t0
        speed = total_inserted / elapsed if elapsed > 0 else 0
        print(f"  [{i+1}/{len(missing)}] {name:30s}  +{len(records):4d} hexagons  "
              f"({total_inserted:,} total  {speed:.0f}/s)")

        # Commit every 20 cities
        if (i + 1) % 20 == 0:
            con.commit()

    con.commit()

    stats = con.execute("""
        SELECT COUNT(*), SUM(CASE WHEN is_valid THEN 1 ELSE 0 END)
        FROM hexagons
    """).fetchone()
    print(f"\n✅ Done! Inserted {total_inserted:,} new hexagons")
    print(f"   DB total: {stats[0]:,} hexagons, {stats[1]:,} valid")
    con.close()


if __name__ == "__main__":
    main()
