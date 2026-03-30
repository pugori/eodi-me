#!/usr/bin/env python3
"""
Backfill POI data for countries with missing Overpass data.

Queries Overpass API for each city in the affected countries,
updates the DuckDB cities table, then backfills hexagons.

Usage:
    python scripts/backfill_missing_poi.py
"""

import json
import math
import time
import sys
import duckdb
import requests

DB_PATH = r"rust-collector/cities.db"
OVERPASS_URLS = [
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass-api.de/api/interpreter",
]
MISSING_COUNTRIES = ["CY", "GE", "HK", "MO", "OM", "CG", "KM", "EH", "FM"]
MIN_POI_THRESHOLD = 20
MAX_RETRIES = 5
BASE_DELAY = 3.0  # seconds between requests


def urban_radius_m(population: int) -> int:
    if population <= 50_000:
        return 3000
    elif population <= 500_000:
        return 5000
    else:
        return 8000


def build_overpass_query(lat: float, lon: float, radius_m: int) -> str:
    return f"""[out:json][timeout:90];
(
  node["amenity"~"^(restaurant|cafe|bar|pub|fast_food|food_court)$"](around:{radius_m},{lat},{lon});
  node["amenity"~"^(museum|theatre|library|arts_centre|cinema|nightclub|spa|atm|marketplace)$"](around:{radius_m},{lat},{lon});
  node["amenity"="bus_station"](around:{radius_m},{lat},{lon});
  node["leisure"~"^(park|garden|sports_centre|fitness_centre|swimming_pool)$"](around:{radius_m},{lat},{lon});
  way["leisure"~"^(park|garden|sports_centre)$"](around:{radius_m},{lat},{lon});
  node["shop"~"^(supermarket|mall|department_store|general|convenience|hairdresser|beauty|barber)$"](around:{radius_m},{lat},{lon});
  way["shop"~"^(mall|supermarket|department_store)$"](around:{radius_m},{lat},{lon});
  node["tourism"~"^(museum|gallery|artwork)$"](around:{radius_m},{lat},{lon});
  node["highway"="bus_stop"](around:800,{lat},{lon});
  node["railway"~"^(station|subway_entrance|tram_stop|halt)$"](around:800,{lat},{lon});
  node["public_transport"~"^(stop_position|platform)$"](around:800,{lat},{lon});
  way["natural"~"^(water|coastline|bay)$"](around:50000,{lat},{lon});
  way["waterway"~"^(river|canal)$"](around:50000,{lat},{lon});
  relation["natural"="water"](around:50000,{lat},{lon});
);
out center tags;"""


def haversine_km(lat1, lon1, lat2, lon2):
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2) ** 2
    return 2 * R * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def is_water(tags):
    return tags.get("natural") in ("water", "coastline", "bay") or tags.get("waterway") in ("river", "canal")


def is_transit(tags):
    return "railway" in tags or tags.get("highway") == "bus_stop" or "public_transport" in tags


def parse_poi(data, city_lat, city_lon, radius_km):
    counts = {
        "restaurant": 0, "cafe": 0, "bar": 0, "fast_food": 0,
        "museum": 0, "theatre": 0, "library": 0, "gallery": 0,
        "park": 0, "garden": 0, "sports_centre": 0, "spa": 0,
        "bus_station": 0, "atm": 0, "nightclub": 0, "cinema": 0,
        "beauty": 0, "hairdresser": 0, "gym": 0,
        "supermarket": 0, "mall": 0, "shop_generic": 0, "marketplace": 0,
        "total_poi": 0, "radius_km": radius_km,
        "nearest_water_km": None,
        "subway_entrances": 0, "rail_stations": 0, "tram_stops": 0, "bus_stops": 0,
    }
    total_poi = 0
    water_coords = []

    for el in data.get("elements", []):
        tags = el.get("tags", {})
        if not tags:
            continue
        center = el.get("center", {})
        el_lat = center.get("lat") or el.get("lat")
        el_lon = center.get("lon") or el.get("lon")
        if el_lat is None or el_lon is None:
            continue

        if is_water(tags):
            water_coords.append((el_lat, el_lon))
            continue
        if is_transit(tags):
            rw = tags.get("railway", "")
            if rw == "subway_entrance" or (rw == "station" and tags.get("station") == "subway"):
                counts["subway_entrances"] += 1
            elif rw in ("station", "halt"):
                counts["rail_stations"] += 1
            elif rw in ("tram_stop", "tram_station"):
                counts["tram_stops"] += 1
            if tags.get("highway") == "bus_stop":
                counts["bus_stops"] += 1
            continue

        amenity = tags.get("amenity", "")
        poi_found = False
        am_map = {
            "restaurant": "restaurant", "cafe": "cafe", "bar": "bar", "pub": "bar",
            "fast_food": "fast_food", "food_court": "fast_food",
            "museum": "museum", "theatre": "theatre", "library": "library",
            "arts_centre": "gallery", "cinema": "cinema", "nightclub": "nightclub",
            "atm": "atm", "spa": "spa", "marketplace": "marketplace", "bus_station": "bus_station",
        }
        if amenity in am_map:
            counts[am_map[amenity]] += 1
            poi_found = True

        leisure = tags.get("leisure", "")
        le_map = {"park": "park", "garden": "garden", "sports_centre": "sports_centre",
                  "fitness_centre": "gym", "gym": "gym", "swimming_pool": "gym"}
        if leisure in le_map:
            counts[le_map[leisure]] += 1
            poi_found = True

        shop = tags.get("shop", "")
        sh_map = {"supermarket": "supermarket", "grocery": "supermarket",
                  "mall": "mall", "department_store": "mall", "general": "mall",
                  "hairdresser": "hairdresser", "barber": "hairdresser",
                  "beauty": "beauty", "cosmetics": "beauty"}
        if shop in sh_map:
            counts[sh_map[shop]] += 1
            poi_found = True
        elif shop and shop not in sh_map:
            counts["shop_generic"] += 1
            poi_found = True

        tourism = tags.get("tourism", "")
        to_map = {"museum": "museum", "gallery": "gallery", "art_gallery": "gallery"}
        if tourism in to_map:
            counts[to_map[tourism]] += 1
            poi_found = True

        if poi_found:
            total_poi += 1

    counts["total_poi"] = total_poi
    if water_coords:
        counts["nearest_water_km"] = min(haversine_km(city_lat, city_lon, wlat, wlon) for wlat, wlon in water_coords)

    return counts


def fetch_poi(session, lat, lon, population, overpass_urls):
    radius_m = urban_radius_m(population)
    radius_km = radius_m / 1000.0
    query = build_overpass_query(lat, lon, radius_m)

    for url_idx, url in enumerate(overpass_urls):
        for attempt in range(MAX_RETRIES):
            try:
                delay = BASE_DELAY * (2 ** attempt)
                if attempt > 0:
                    time.sleep(delay)
                resp = session.post(url, data={"data": query}, timeout=120)
                if resp.status_code == 429:
                    print(f"    Rate limited (429) on {url}, attempt {attempt+1}/{MAX_RETRIES}")
                    continue
                if resp.status_code == 504:
                    print(f"    Timeout (504) on {url}, attempt {attempt+1}/{MAX_RETRIES}")
                    continue
                if resp.status_code != 200:
                    print(f"    HTTP {resp.status_code} on {url}, attempt {attempt+1}/{MAX_RETRIES}")
                    continue
                data = resp.json()
                return parse_poi(data, lat, lon, radius_km)
            except requests.exceptions.Timeout:
                print(f"    Client timeout on {url}, attempt {attempt+1}/{MAX_RETRIES}")
            except Exception as e:
                print(f"    Error on {url}: {e}, attempt {attempt+1}/{MAX_RETRIES}")

        if url_idx < len(overpass_urls) - 1:
            print(f"    Switching to next Overpass server...")

    return None


def main():
    print("=" * 60)
    print("  EODI.ME POI Backfill for Missing Countries")
    print("=" * 60)

    conn = duckdb.connect(DB_PATH)
    session = requests.Session()
    session.headers.update({"User-Agent": "eodi.me-collector/1.0 (backfill)"})

    # Get cities needing POI data
    cities = conn.execute(f"""
        SELECT geoname_id, name, latitude, longitude, country_code, population
        FROM cities
        WHERE country_code IN ({','.join(f"'{c}'" for c in MISSING_COUNTRIES)})
          AND (poi_data IS NULL OR poi_data = '')
        ORDER BY country_code, population DESC
    """).fetchall()

    print(f"\nTarget: {len(cities)} cities in {len(MISSING_COUNTRIES)} countries")
    print(f"Countries: {', '.join(MISSING_COUNTRIES)}")
    print(f"Overpass servers: {len(OVERPASS_URLS)}")
    print()

    success = 0
    failed = 0
    total = len(cities)
    current_cc = ""

    for i, (gid, name, lat, lon, cc, pop) in enumerate(cities):
        if cc != current_cc:
            current_cc = cc
            cc_count = sum(1 for c in cities if c[4] == cc)
            print(f"\n--- {cc} ({cc_count} cities) ---")

        print(f"  [{i+1}/{total}] {name} ({cc}, pop={pop:,}) ", end="", flush=True)

        poi = fetch_poi(session, lat, lon, pop, OVERPASS_URLS)
        if poi is None:
            print("FAILED ❌")
            failed += 1
            continue

        poi_json = json.dumps(poi)
        conn.execute(
            "UPDATE cities SET poi_data = ?, is_valid = 1 WHERE geoname_id = ?",
            [poi_json, gid]
        )
        print(f"total_poi={poi['total_poi']} ✅")
        success += 1

        # Rate limit between requests
        time.sleep(BASE_DELAY)

    print(f"\n{'='*60}")
    print(f"City POI collection complete: {success}/{total} success, {failed} failed")

    # Now backfill hexagons from city POI
    print(f"\n--- Backfilling hexagon POI from city data ---")
    for cc in MISSING_COUNTRIES:
        before = conn.execute(f"""
            SELECT COUNT(*) FROM hexagons h
            JOIN cities c ON h.parent_city_id = c.geoname_id
            WHERE c.country_code = '{cc}' AND h.is_valid = true
        """).fetchone()[0]

        conn.execute(f"""
            UPDATE hexagons
            SET poi_data = c.poi_data,
                is_valid = CASE
                    WHEN c.poi_data IS NOT NULL AND c.poi_data != ''
                     AND COALESCE(TRY_CAST(json_extract_string(c.poi_data, '$.total_poi') AS INTEGER), 0) >= {MIN_POI_THRESHOLD}
                    THEN true ELSE false
                END
            FROM cities c
            WHERE hexagons.parent_city_id = c.geoname_id
              AND c.country_code = '{cc}'
              AND c.poi_data IS NOT NULL
              AND c.poi_data != ''
        """)

        after = conn.execute(f"""
            SELECT COUNT(*) FROM hexagons h
            JOIN cities c ON h.parent_city_id = c.geoname_id
            WHERE c.country_code = '{cc}' AND h.is_valid = true
        """).fetchone()[0]

        print(f"  {cc}: {before} → {after} valid hexagons (+{after - before})")

    # Final stats
    total_valid = conn.execute("SELECT COUNT(*) FROM hexagons WHERE is_valid = true").fetchone()[0]
    total_countries = conn.execute("""
        SELECT COUNT(DISTINCT c.country_code)
        FROM hexagons h JOIN cities c ON h.parent_city_id = c.geoname_id
        WHERE h.is_valid = true
    """).fetchone()[0]
    print(f"\n{'='*60}")
    print(f"Total valid hexagons: {total_valid:,}")
    print(f"Total countries with valid hexagons: {total_countries}")
    print(f"{'='*60}")

    conn.close()


if __name__ == "__main__":
    main()
