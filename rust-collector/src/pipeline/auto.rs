//! Automatic pipeline — invoked when the executable is run with no arguments.
//!
//! Auto-detects `cities15000.txt`, prints a short banner, then returns the
//! `Commands::BuildFull` variant that `main` will dispatch.

use anyhow::Result;
use std::path::PathBuf;

use crate::cli::Commands;

/// Auto-detect the cities file and return a fully-parameterised
/// `Commands::BuildFull` (resumed, all stages).
pub async fn run_auto_pipeline(
    _database_path: &std::path::Path,
    output_path: &std::path::Path,
) -> Result<Commands> {
    // ── Banner ────────────────────────────────────────────────────────────────
    println!();
    println!("╔══════════════════════════════════════════════════════╗");
    println!("║        EODI City Data Collector - Auto Mode          ║");
    println!("║        City Vibe Engine Full Pipeline                ║");
    println!("╚══════════════════════════════════════════════════════╝");
    println!();

    // ── Auto-detect cities file ───────────────────────────────────────────────
    let candidates = [
        PathBuf::from("data/cities15000.txt"),
        PathBuf::from("cities15000.txt"),
        PathBuf::from("../cities15000.txt"),
        PathBuf::from("문서/cities15000.txt"),
    ];

    let cities_file = candidates
        .into_iter()
        .find(|p| p.exists())
        .ok_or_else(|| {
            eprintln!();
            eprintln!("❌ cities15000.txt not found!");
            eprintln!();
            eprintln!("   Please run: .\\download-cities-data.ps1");
            eprintln!("   Or download from: https://download.geonames.org/export/dump/cities15000.zip");
            eprintln!("   And place it at: data/cities15000.txt");
            eprintln!();
            anyhow::anyhow!("cities15000.txt not found")
        })?;

    let output_file = output_path.join("cities.edb");

    println!("  ✓ Cities file : {}", cities_file.display());
    println!("  ✓ Output      : {}", output_file.display());
    println!();
    println!("  Pipeline stages:");
    println!("    Stage 1  — Collect 33,297 cities (GeoNames + metadata)");
    println!("    Stage 2  — POI data per city (Overpass/PBF)");
    println!("    Stage 3  — Build cities.edb (encrypted 13D vectors)");
    println!("    Stage 4  — Download OSM admin boundaries per country (~195 queries)");
    println!("    Stage 4b — Generate H3 Res-8 hexagons + local Max Areal Overlap");
    println!("    Stage 5  — Build hexagons.edbh (encrypted hex vectors)");
    println!();
    println!("  ✓ Concurrency : 6 (POI), 8 (hexagons)");
    println!("  ✓ Resume      : enabled (safe to restart)");
    println!();
    println!("  Starting full pipeline in 3 seconds... (Ctrl+C to cancel)");
    tokio::time::sleep(std::time::Duration::from_secs(3)).await;
    println!();

    Ok(Commands::BuildFull {
        cities_file,
        limit: 0,
        output: output_file,
        poi_concurrency: 6,
        skip_cities: false,
        skip_poi: false,
        skip_hexagons: false,
        batch_size: 500,
        overpass_api: "https://overpass-api.de/api/interpreter".to_string(),
    })
}
