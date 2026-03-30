//! Command handler: `collect-cities`
//!
//! Parses `cities15000.txt`, pre-fetches country data from the REST Countries
//! API and batch-inserts all city rows in a single DuckDB transaction.
//!
//! # Concurrency model
//!
//! Country data is fetched concurrently (one request per country code, ~200
//! total).  CityData assembly is pure-sync (no I/O).  Final insert uses
//! `insert_city_batch` which holds a single DuckDB write connection and wraps
//! all rows in one transaction — ~20× faster than per-row inserts and avoids
//! the "multiple writer" DuckDB constraint.

use anyhow::Result;
use futures::stream::{self, StreamExt};
use indicatif::{ProgressBar, ProgressStyle};
use std::path::PathBuf;
use std::sync::Arc;
use tracing::{info, warn};

use crate::city::CityData;
use crate::collector::Collector;
use crate::commands::AppContext;
use crate::pipeline::cities::{collect_city_data_sync, parse_cities_file};

pub struct CollectCitiesArgs {
    pub cities_file: PathBuf,
    pub limit: usize,
    pub resume: bool,
    pub validate: bool,
}

pub async fn run(ctx: &AppContext, args: CollectCitiesArgs) -> Result<()> {
    info!("🌍 City Data Collection Started");
    info!("📂 Cities file: {:?}", args.cities_file);
    info!("💾 Database: {:?}", ctx.database_path);
    info!("🔄 Resume: {}", args.resume);
    info!("✅ Validate: {}", args.validate);

    let cities = parse_cities_file(&args.cities_file, args.limit).await?;
    let total_cities = cities.len();
    info!("📊 Total cities to process: {}", total_cities);

    // Filter already-collected if resume is on.
    let to_collect = if args.resume {
        let already_collected = ctx.db.get_collected_city_ids().await?;
        let filtered: Vec<_> = cities
            .into_iter()
            .filter(|c| !already_collected.contains(&c.geoname_id))
            .collect();
        info!(
            "✨ Resuming: {} already collected, {} remaining",
            total_cities - filtered.len(),
            filtered.len()
        );
        filtered
    } else {
        cities
    };

    if to_collect.is_empty() {
        info!("✅ All cities already collected!");
        return Ok(());
    }

    let total = to_collect.len();

    // Graceful shutdown.
    let shutdown = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let shutdown_c = shutdown.clone();
    tokio::spawn(async move {
        if tokio::signal::ctrl_c().await.is_ok() {
            warn!("\n⚠️  Shutdown signal received. Finishing current tasks...");
            shutdown_c.store(true, std::sync::atomic::Ordering::Relaxed);
        }
    });

    // Pre-fetch country data (one request per country code, not per city).
    let unique_codes: std::collections::HashSet<String> =
        to_collect.iter().map(|c| c.country_code.clone()).collect();
    let country_col = Arc::new(Collector::new("eodi.me-collector/1.0", 0.1, 10.0));
    let country_cache: Arc<std::collections::HashMap<String, Option<String>>> = Arc::new(
        stream::iter(unique_codes.into_iter())
            .map(|code| {
                let col = country_col.clone();
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
    info!("🌍 Country cache ready");

    // ── Build CityData in memory (pure sync, no I/O) ──────────────────────────
    let pb = ProgressBar::new(total as u64);
    pb.set_style(
        ProgressStyle::default_bar()
            .template("{spinner:.green} [{elapsed_precise}] [{bar:40.cyan/blue}] {pos}/{len} ({percent}%) {msg}")
            .unwrap()
            .progress_chars("#>-"),
    );
    pb.set_message("Assembling city records…");

    let mut all_city_data: Vec<CityData> = Vec::with_capacity(total);
    let mut invalid_count = 0usize;
    for city in &to_collect {
        if shutdown.load(std::sync::atomic::Ordering::Relaxed) {
            warn!("⚠️  Shutdown signal received. Stopping early.");
            break;
        }
        let city_data = collect_city_data_sync(&country_cache, city);
        if args.validate && !city_data.is_valid() {
            invalid_count += 1;
        }
        all_city_data.push(city_data);
        pb.inc(1);
    }
    pb.finish_with_message(format!("✅ Assembled {} cities ({} invalid)", all_city_data.len(), invalid_count));

    if all_city_data.is_empty() {
        info!("✅ Nothing to insert.");
        return Ok(());
    }

    // ── Single-transaction batch insert (avoids DuckDB multi-writer conflict) ─
    info!("💾 Batch-inserting {} cities into DuckDB…", all_city_data.len());
    let saved = ctx.db.insert_city_batch(&all_city_data).await?;
    let failed = all_city_data.len() - saved;

    info!("✅ Success: {}", saved);
    if failed > 0 {
        info!("❌ Failed: {}", failed);
    }
    Ok(())
}
