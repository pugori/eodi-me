#!/usr/bin/env python3
"""Quick DuckDB health check for rust-collector cities database."""

from __future__ import annotations

import argparse
from pathlib import Path

import duckdb


def resolve_db_path(input_path: str | None) -> Path:
    script_dir = Path(__file__).resolve().parent
    project_root = script_dir.parent
    if input_path:
        return Path(input_path).expanduser().resolve()
    return project_root / "cities.db"


def main() -> None:
    parser = argparse.ArgumentParser(description="Check cities DuckDB status")
    parser.add_argument("--db", help="Path to cities.db")
    args = parser.parse_args()

    db_path = resolve_db_path(args.db)
    if not db_path.exists():
        raise SystemExit(f"Database not found: {db_path}")

    con = duckdb.connect(str(db_path), read_only=True)
    try:
        total = con.execute("SELECT COUNT(*) FROM cities").fetchone()[0]
        valid = con.execute("SELECT COUNT(*) FROM cities WHERE is_valid=1").fetchone()[0]
        invalid = con.execute("SELECT COUNT(*) FROM cities WHERE is_valid=0").fetchone()[0]
        no_country = con.execute("SELECT COUNT(*) FROM cities WHERE country_info IS NULL").fetchone()[0]

        print(f"DB: {db_path}")
        print(f"total       : {total:,}")
        print(f"is_valid=1  : {valid:,}")
        print(f"is_valid=0  : {invalid:,}")
        print(f"country NULL: {no_country:,}")

        print("\n=== 최근 수집 5개 ===")
        rows = con.execute(
            "SELECT name, country_code, is_valid, collected_at FROM cities ORDER BY collected_at DESC LIMIT 5"
        ).fetchall()
        for row in rows:
            print(row)
    finally:
        con.close()


if __name__ == "__main__":
    main()
