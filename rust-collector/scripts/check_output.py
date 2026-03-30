#!/usr/bin/env python3
"""Quick output artifact check for rust-collector."""

from __future__ import annotations

import argparse
from pathlib import Path


def resolve_project_root() -> Path:
    return Path(__file__).resolve().parent.parent


def human_mb(path: Path) -> float:
    return path.stat().st_size / (1024 * 1024)


def main() -> None:
    parser = argparse.ArgumentParser(description="Check output artifacts")
    parser.add_argument("--root", help="Project root path")
    args = parser.parse_args()

    root = Path(args.root).expanduser().resolve() if args.root else resolve_project_root()
    edb = root / "output" / "cities.edb"
    edbh = root / "output" / "hexagons.edbh"

    print(f"Root: {root}")
    if edb.exists():
        print(f"cities.edb     : {human_mb(edb):.1f} MB")
    else:
        print("cities.edb     : 없음")

    if edbh.exists():
        print(f"hexagons.edbh  : {human_mb(edbh):.1f} MB")
    else:
        print("hexagons.edbh  : 없음")


if __name__ == "__main__":
    main()
