//! Command handler: `collect-hexagons`
//!
//! Standalone H3 Res-8 hexagon collection using pre-downloaded admin
//! boundaries from the local R-tree index.
//!
//! **Country-partitioned strategy**: boundaries are loaded and released
//! one country at a time so peak memory stays at ~500 MB (vs 25 GB for
//! the whole-world approach).

use anyhow::Result;
use futures::stream::{self, StreamExt};
use indicatif::{ProgressBar, ProgressStyle};
use std::collections::HashMap;
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc,
};
use tracing::{info, warn};

use crate::boundary;
use crate::commands::AppContext;
use crate::hexagon;

pub struct CollectHexagonsArgs {
    pub limit: usize,
    pub overpass_api: String,
    pub concurrency: usize,
    pub resume: bool,
}

pub async fn run(ctx: &AppContext, args: CollectHexagonsArgs) -> Result<()> {
    info!("🔷 H3 Hexagon Collection (country-partitioned, Max Areal Overlap)");
    info!("📂 Database: {:?}", ctx.database_path);
    info!("🔗 Overpass API: {} (POI only)", args.overpass_api);
    info!(
        "🔧 Concurrency: {} per country",
        args.concurrency
    );

    // Warn if no boundaries downloaded.
    {
        let conn = ctx.db.open()?;
        let bc: i64 = conn
            .query_row("SELECT COUNT(*) FROM boundaries", [], |r| r.get(0))
            .unwrap_or(0);
        if bc == 0 {
            warn!("⚠️  No boundary polygons in DB — run 'download-boundaries' first.");
            warn!("   Continuing with city-name fallback labels…");
        } else {
            info!("📦 {} boundary polygons available", bc);
        }
    }

    // Load all cities, apply limit.
    let all_cities = ctx.db.get_all_cities_basic().await?;
    let cities = if args.limit > 0 && args.limit < all_cities.len() {
        all_cities.into_iter().take(args.limit).collect::<Vec<_>>()
    } else {
        all_cities
    };
    info!("📊 Total cities to hexagonize: {}", cities.len());

    let stats_before = ctx.db.get_hex_stats().await?;
    info!(
        "📈 Hexagons already in DB: {} total, {} valid",
        stats_before.total, stats_before.valid
    );

    // Group cities by country code for per-country boundary loading.
    let mut by_country: HashMap<String, Vec<crate::city::CityBasic>> = HashMap::new();
    for city in cities {
        by_country
            .entry(city.country_code.to_uppercase())
            .or_default()
            .push(city);
    }
    // Sort countries: smallest boundary count first (so early countries finish fast).
    let mut country_list: Vec<String> = by_country.keys().cloned().collect();
    country_list.sort();

    let total_cities: usize = by_country.values().map(|v| v.len()).sum();
    let pb = ProgressBar::new(total_cities as u64);
    pb.set_style(
        ProgressStyle::default_bar()
            .template("{spinner:.green} [{elapsed_precise}] [{bar:40.cyan/blue}] {pos}/{len} ({percent}%) {msg}")
            .unwrap()
            .progress_chars("#>-"),
    );

    let total_valid = Arc::new(AtomicUsize::new(0));
    let http_client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .tcp_keepalive(std::time::Duration::from_secs(30))
        .build()?;

    let mut total_saved = 0usize;
    let n_countries = country_list.len();

    for (ci, cc) in country_list.iter().enumerate() {
        let country_cities = match by_country.remove(cc) {
            Some(v) => v,
            None => continue,
        };

        // Load boundaries for this country only, build a fresh R-tree.
        // Dropped at the end of the loop iteration → memory freed.
        let boundary_index = Arc::new(
            ctx.db
                .build_boundary_index_for_countries(&[cc.clone()])
                .await?,
        );

        info!(
            "🌍 [{}/{n_countries}] {} — {} cities, {} boundaries",
            ci + 1,
            cc,
            country_cities.len(),
            boundary_index.len(),
        );

        let db_arc = Arc::new(ctx.db.clone());
        let mut stream = stream::iter(country_cities.into_iter())
            .map(|city| {
                let client = http_client.clone();
                let pb = pb.clone();
                let valid_c = total_valid.clone();
                let overpass_url = args.overpass_api.clone();
                let bidx = boundary_index.clone();
                let db = db_arc.clone();
                let resume = args.resume;
                async move {
                    if resume {
                        if let Ok(existing) =
                            db.get_collected_hex_ids_for_city(city.geoname_id).await
                        {
                            if !existing.is_empty() {
                                pb.inc(1);
                                return vec![];
                            }
                        }
                    }

                    pb.set_message(format!("[{}] ⬡ {}", cc, city.name));
                    let records = hexagon::collect_city_hexagons(
                        &client,
                        city.geoname_id,
                        &city.name,
                        city.latitude,
                        city.longitude,
                        city.population,
                        &overpass_url,
                        &bidx,
                    )
                    .await;

                    let valid = records.iter().filter(|r| r.is_valid).count();
                    valid_c.fetch_add(valid, Ordering::Relaxed);
                    pb.inc(1);
                    pb.set_message(format!(
                        "[{}] ✅ {} → {} hex ({} valid)",
                        cc,
                        city.name,
                        records.len(),
                        valid
                    ));
                    records
                }
            })
            .buffer_unordered(args.concurrency);

        // Drain and save incrementally.
        let mut country_saved = 0usize;
        let mut batch: Vec<crate::hexagon::HexRecord> = Vec::new();
        while let Some(records) = stream.next().await {
            batch.extend(records);
            if batch.len() >= 500 {
                ctx.db.upsert_hexagons(&batch).await?;
                country_saved += batch.len();
                batch.clear();
            }
        }
        if !batch.is_empty() {
            ctx.db.upsert_hexagons(&batch).await?;
            country_saved += batch.len();
        }
        total_saved += country_saved;

        if country_saved > 0 {
            info!("   └─ saved {} hexagons", country_saved);
        }
    }

    pb.finish_with_message("✅ Hexagon collection complete");

    let valid_count = total_valid.load(Ordering::Relaxed);
    let stats = ctx.db.get_hex_stats().await?;

    info!("\n🎉 Hexagon Collection Complete!");
    info!("⬡  Hexagons saved this run: {}", total_saved);
    info!(
        "✅  Valid (POI ≥{}):         {}",
        hexagon::MIN_POI_THRESHOLD,
        valid_count
    );
    info!("📊 DB total hexagons:        {}", stats.total);
    info!("📊 DB valid hexagons:        {}", stats.valid);
    info!("🌍 Cities covered:           {}", stats.cities_covered);
    info!("🗺️  Distinct admin areas:     {}", stats.admin_areas);
    Ok(())
}
