import duckdb

con = duckdb.connect("cities.db", read_only=True)

print("=== Hexagon DB state ===")
total = con.execute("SELECT COUNT(*) FROM hexagons").fetchone()[0]
valid = con.execute("SELECT COUNT(*) FROM hexagons WHERE is_valid = TRUE").fetchone()[0]
cities_covered = con.execute("SELECT COUNT(DISTINCT parent_city_id) FROM hexagons WHERE is_valid = TRUE").fetchone()[0]
print(f"  Total hexagons: {total:,}")
print(f"  Valid hexagons: {valid:,}")
print(f"  Cities covered: {cities_covered:,}")

print()
print("=== Per-hex POI diversity (top cities) ===")
diverse = con.execute("""
SELECT parent_city_name, COUNT(*) total_hex, COUNT(DISTINCT poi_data) distinct_poi
FROM hexagons
WHERE is_valid = TRUE
GROUP BY parent_city_name
HAVING COUNT(*) > 50
ORDER BY COUNT(DISTINCT poi_data) DESC
LIMIT 20
""").fetchall()
for row in diverse:
    print(f"  {row[0]}: {row[2]} distinct values / {row[1]} hexagons")

print()
print("=== Missing top cities (no hexagons after recollect) ===")
missing = con.execute("""
SELECT c.name, c.country_code, c.population
FROM cities c
LEFT JOIN hexagons h ON h.parent_city_id = c.geoname_id
WHERE c.is_valid=1 AND c.population > 1000000 AND h.h3_index IS NULL
ORDER BY c.population DESC
LIMIT 15
""").fetchall()
if missing:
    for r in missing:
        print(f"  MISSING: {r[0]} ({r[1]}): {r[2]:,}")
else:
    print("  All top cities have hexagons ✅")

con.close()
