//! Misc commands: Stats, Validate, Repair, Export, ExportHexagons.

use anyhow::Result;
use std::path::PathBuf;
use std::sync::Arc;
use tracing::info;

use futures::stream::{self, StreamExt};

use crate::city::{CityBasic, CityData};
use crate::collector::Collector;
use crate::commands::AppContext;
use crate::pipeline::cities::collect_city_data;

// ─────────────────────────────────────────────────────────────────────────────

pub async fn run_stats(ctx: &AppContext) -> Result<()> {
    let stats = ctx.db.get_stats().await?;

    println!("\n📊 Database Statistics");
    println!("═══════════════════════════════");
    println!("Total Cities:     {}", stats.total);
    println!("With Weather:     {}", stats.with_weather);
    println!("With Country:     {}", stats.with_country);
    println!("Complete Data:    {}", stats.complete);
    println!("Incomplete:       {}", stats.incomplete);
    println!("Validation Rate:  {:.1}%", stats.validation_rate());
    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────────

pub async fn run_validate(ctx: &AppContext) -> Result<()> {
    info!("🔍 Validating database...");
    let invalid = ctx.db.find_invalid_cities().await?;

    if invalid.is_empty() {
        info!("✅ All cities have valid data!");
    } else {
        info!(
            "⚠️  Found {} cities with invalid/incomplete data:",
            invalid.len()
        );
        for city_id in invalid.iter().take(10) {
            println!("  - City ID: {}", city_id);
        }
        if invalid.len() > 10 {
            println!("  ... and {} more", invalid.len() - 10);
        }
    }
    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────────

pub async fn run_repair(ctx: &AppContext, force: bool) -> Result<()> {
    info!("🔧 Repairing database...");

    let to_repair = if force {
        ctx.db.get_all_city_ids().await?
    } else {
        ctx.db.find_invalid_cities().await?
    };

    if to_repair.is_empty() {
        info!("✅ Nothing to repair!");
        return Ok(());
    }

    info!("🔄 Re-collecting {} cities", to_repair.len());
    let cities: Vec<CityBasic> = ctx.db.get_cities_by_ids(&to_repair).await?;
    info!("📊 Retrieved {} cities from database", cities.len());

    let total = cities.len();
    let unique_codes: std::collections::HashSet<String> =
        cities.iter().map(|c| c.country_code.clone()).collect();

    let col = Arc::new(Collector::new("eodi.me-collector/1.0", 0.1, 10.0));
    let cache: Arc<std::collections::HashMap<String, Option<String>>> = Arc::new(
        stream::iter(unique_codes.into_iter())
            .map(|code| {
                let col = col.clone();
                async move {
                    let url = format!("https://restcountries.com/v3.1/alpha/{}", code);
                    let result = col
                        .fetch(&url)
                        .await
                        .map(|d| String::from_utf8_lossy(&d).to_string())
                        .ok();
                    (code, result)
                }
            })
            .buffer_unordered(32)
            .collect::<Vec<_>>()
            .await
            .into_iter()
            .collect(),
    );

    let results: Vec<CityData> = stream::iter(cities.into_iter().enumerate())
        .map(|(idx, city)| {
            let cache = cache.clone();
            async move {
                info!(
                    "[{}/{}] Repairing: {} ({})",
                    idx + 1,
                    total,
                    city.name,
                    city.country_code
                );
                collect_city_data(&cache, &city).await
            }
        })
        .buffer_unordered(32)
        .collect()
        .await;

    let mut success = 0;
    let mut failed = 0;
    for city_data in results {
        ctx.db.insert_city(&city_data).await?;
        if city_data.is_valid() {
            success += 1;
        } else {
            failed += 1;
        }
    }

    info!("\n✅ Repair Complete!");
    info!("✅ Success: {}", success);
    info!("❌ Failed: {}", failed);
    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────────

pub async fn run_export(ctx: &AppContext, output: Option<PathBuf>) -> Result<()> {
    let export_path = output.unwrap_or_else(|| ctx.output_path.join("cities_export.json"));
    info!("📤 Exporting data to {:?}", export_path);
    ctx.db.export_to_json(&export_path).await?;
    info!("✅ Export complete!");
    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────────

pub async fn run_export_hexagons(ctx: &AppContext, output: PathBuf) -> Result<()> {
    info!("📦 Exporting valid hexagons to Parquet: {:?}", output);
    ctx.db.export_hexagons_parquet(&output).await?;
    info!("✅ Parquet export complete!");
    Ok(())
}
