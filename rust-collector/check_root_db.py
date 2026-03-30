from pathlib import Path

import duckdb

REPO_ROOT = Path(__file__).resolve().parents[1]
db_path = REPO_ROOT / "cities.db"

con = duckdb.connect(str(db_path), read_only=True)
total = con.execute("SELECT COUNT(*) FROM cities").fetchone()[0]
valid = con.execute("SELECT COUNT(*) FROM cities WHERE is_valid=1").fetchone()[0]
invalid = con.execute("SELECT COUNT(*) FROM cities WHERE is_valid=0").fetchone()[0]
no_country = con.execute("SELECT COUNT(*) FROM cities WHERE country_info IS NULL").fetchone()[0]
print(f"total       : {total:,}")
print(f"is_valid=1  : {valid:,}")
print(f"is_valid=0  : {invalid:,}")
print(f"country NULL: {no_country:,}")
rows = con.execute("SELECT name, country_code, is_valid, collected_at FROM cities ORDER BY collected_at DESC LIMIT 5").fetchall()
print()
print("=== 최근 수집 5개 ===")
for r in rows:
    print(r)

# Stage 2 (POI) 진행 현황 확인
has_poi = con.execute("SELECT COUNT(*) FROM cities WHERE poi_data IS NOT NULL").fetchone()[0]
print(f"\nPOI 수집된 도시: {has_poi:,}")

# output 파일 확인
edb_path = REPO_ROOT / "output" / "cities.edb"
if edb_path.exists():
    size = edb_path.stat().st_size / (1024 * 1024)
    print(f"cities.edb  : {size:.1f} MB (있음)")
else:
    print("cities.edb  : 없음 (Stage 3 미완)")

con.close()
