"""
Recollect per-hexagon POI for the top N cities by population.
Deletes existing hexagon records for those cities so collect-hexagons --resume
will re-collect them with real per-hexagon Overpass POI queries.
"""
import duckdb
import sys

N = int(sys.argv[1]) if len(sys.argv) > 1 else 500

print(f"Opening cities.db in write mode...")
con = duckdb.connect("cities.db", read_only=False)

# Get top N cities by population
print(f"\nSelecting top {N} cities by population...")
top_cities = con.execute(f"""
    SELECT geoname_id, name, country_code, population
    FROM cities
    WHERE is_valid = 1 AND population > 0
    ORDER BY population DESC
    LIMIT {N}
""").fetchall()

print(f"Got {len(top_cities)} cities. Sample:")
for c in top_cities[:10]:
    print(f"  {c[1]} ({c[2]}): {c[3]:,}")

# Count existing hexagons for these cities
geoname_ids = [str(c[0]) for c in top_cities]
ids_str = ",".join(geoname_ids)

existing = con.execute(f"""
    SELECT COUNT(*) FROM hexagons
    WHERE parent_city_id IN ({ids_str})
""").fetchone()[0]
print(f"\nExisting hexagons for these {N} cities: {existing:,}")

if existing == 0:
    print("No hexagons to delete. Run collect-hexagons without --resume.")
    con.close()
    sys.exit(0)

# Delete hexagon records for these cities
print(f"\nDeleting {existing:,} hexagons for top {N} cities...")
con.execute(f"DELETE FROM hexagons WHERE parent_city_id IN ({ids_str})")

# Verify deletion
remaining = con.execute(f"""
    SELECT COUNT(*) FROM hexagons
    WHERE parent_city_id IN ({ids_str})
""").fetchone()[0]
print(f"Remaining after delete: {remaining:,}")

total = con.execute("SELECT COUNT(*) FROM hexagons").fetchone()[0]
valid = con.execute("SELECT COUNT(*) FROM hexagons WHERE is_valid = TRUE").fetchone()[0]
print(f"\nDB state: {total:,} total hexagons, {valid:,} valid")

con.close()
print(f"\n✅ Done. Now run:")
print(f"   eodi-collector.exe collect-hexagons --resume --database cities.db --concurrency 6 --overpass-api https://overpass.kumi.systems/api/interpreter")
