//! Command handler: `download-boundaries`
//!
//! Bulk-downloads OSM admin-boundary polygons per country via Overpass and
//! stores them in the DB for local Max Areal Overlap hexagon assignment.

use anyhow::Result;
use indicatif::{ProgressBar, ProgressStyle};
use std::time::Duration;
use tokio::time::sleep;
use tracing::{info, warn};

use crate::boundary;
use crate::commands::AppContext;

pub struct DownloadBoundariesArgs {
    pub overpass_api: String,
    pub resume: bool,
    pub countries: String,
}

pub async fn run(ctx: &AppContext, args: DownloadBoundariesArgs) -> Result<()> {
    info!("🗺️  OSM Admin Boundary Bulk Download");
    info!("📂 Database: {:?}", ctx.database_path);
    info!("🔗 Overpass API: {}", args.overpass_api);

    // Determine the full country list from DB.
    let all_cities = ctx.db.get_all_cities_basic().await?;
    let mut all_codes = boundary::unique_country_codes(&all_cities);

    // Optional filter.
    if !args.countries.is_empty() {
        let requested: std::collections::HashSet<String> = args
            .countries
            .split(',')
            .map(|s| s.trim().to_uppercase())
            .collect();
        all_codes.retain(|cc| requested.contains(cc));
        info!(
            "🎯 Filtered to {} countries: {}",
            all_codes.len(),
            args.countries
        );
    }

    // Resume: skip already-downloaded.
    let pending = if args.resume {
        let done = ctx.db.get_downloaded_boundary_countries().await?;
        let remaining: Vec<String> = all_codes
            .into_iter()
            .filter(|cc| !done.contains(cc))
            .collect();
        info!(
            "⏩ Resume: {} already done, {} remaining",
            done.len(),
            remaining.len()
        );
        remaining
    } else {
        all_codes
    };

    if pending.is_empty() {
        info!("✅ All boundary data already downloaded!");
        return Ok(());
    }

    info!("📥 Downloading boundaries for {} countries…", pending.len());

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(210))
        .build()?;

    let pb = ProgressBar::new(pending.len() as u64);
    pb.set_style(
        ProgressStyle::default_bar()
            .template("{spinner:.green} [{elapsed_precise}] [{bar:40.cyan/blue}] {pos}/{len} ({percent}%) {msg}")
            .unwrap()
            .progress_chars("#>-"),
    );

    let total = pending.len();
    let mut total_saved = 0usize;
    let mut success_count = 0usize;

    // Download and save per-country so resume works correctly and DB shows progress.
    for (i, cc) in pending.iter().enumerate() {
        pb.set_message(format!("{} ({}/{})", cc, i + 1, total));

        let mut attempts = 0u32;
        let mut country_recs: Vec<boundary::BoundaryRecord> = Vec::new();

        while attempts < 5 {
            attempts += 1;
            match boundary::download_country_boundaries(&client, cc, &args.overpass_api).await {
                Ok(recs) => {
                    country_recs = recs;
                    break;
                }
                Err(e) => {
                    let is_rate_limit = e.to_string().contains("429");
                    let wait_secs = if is_rate_limit { 60 * attempts as u64 } else { 10 * attempts as u64 };
                    warn!(
                        "⚠️  {} (attempt {}): {} — waiting {}s",
                        cc, attempts, e, wait_secs
                    );
                    if attempts < 5 {
                        sleep(Duration::from_secs(wait_secs)).await;
                    }
                }
            }
        }

        if country_recs.is_empty() && attempts >= 5 {
            warn!("❌ Skipping {} after 5 failed attempts", cc);
        } else {
            let n = country_recs.len();
            ctx.db.upsert_boundaries(&country_recs).await?;
            total_saved += n;
            success_count += 1;
            info!("✅ {} → {} polygons saved ({}/{})", cc, n, success_count, total);
        }

        pb.inc(1);

        // Rate limit: 3s between countries.
        if i + 1 < total {
            sleep(Duration::from_millis(3000)).await;
        }
    }

    pb.finish_with_message("✅ Download complete");

    let stats = ctx.db.get_boundary_stats().await?;
    info!("\n🎉 Boundary Download Complete!");
    info!("🗺️  Total polygons saved: {}", total_saved);
    info!("🌍 Countries with data:  {}", stats.len());
    info!("📊 Top 5 by polygon count:");
    for (cc, cnt) in stats.iter().take(5) {
        info!("   {} → {} polygons", cc, cnt);
    }
    info!("\n👉 Next: run 'collect-hexagons' to generate hexagons with local boundary assignment");
    Ok(())
}
