//! Command handler: `build-full`
//!
//! Full pipeline — Stage 1 → 2 → 3 → 4 → 4b → 5.

use anyhow::{anyhow, Result};
use futures::stream::{self, StreamExt};
use indicatif::{ProgressBar, ProgressStyle};
use std::path::PathBuf;
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc,
};
use tracing::{info, warn};

use crate::boundary;
use crate::collector::Collector;
use crate::commands::AppContext;
use crate::hexagon;
use crate::normalizer;
use crate::pipeline::cities::{collect_city_data_sync, parse_cities_file};
use crate::pipeline::vdb::build_city_vdb_from_db;
use crate::stages;
use crate::vectordb;

pub struct BuildFullArgs {
    pub cities_file: PathBuf,
    pub limit: usize,
    pub output: PathBuf,
    pub poi_concurrency: usize,
    pub batch_size: usize,
    pub skip_cities: bool,
    pub skip_poi: bool,
    pub skip_hexagons: bool,
    pub overpass_api: String,
}

pub async fn run(ctx: &AppContext, args: BuildFullArgs) -> Result<()> {
    info!("🚀 Full Pipeline: Cities → POI → Encrypted VDB");
    info!("📂 Database: {:?}", ctx.database_path);
    info!("📤 Output: {:?}", args.output);
    info!("🔧 POI Concurrency: {}", args.poi_concurrency);

    // ═══════════════════════════════════════════════════════════════════════
    // STAGE 1/5: Collect Cities Data
    // ═══════════════════════════════════════════════════════════════════════
    if !args.skip_cities {
        info!("\n━━━ STAGE 1/5: Collecting Cities Data ━━━");
        stage_collect_cities(ctx, &args).await?;
    } else {
        info!("\n━━━ STAGE 1/5: Skipped (--skip-cities) ━━━");
    }

    // ═══════════════════════════════════════════════════════════════════════
    // STAGE 2/5: Collect POI Data
    // ═══════════════════════════════════════════════════════════════════════
    stages::execute_stage_poi(
        &ctx.db,
        args.limit,
        args.skip_poi,
        args.poi_concurrency,
        &ctx.database_path,
    )
    .await?;

    // ═══════════════════════════════════════════════════════════════════════
    // STAGE 3/5: Build Encrypted City VDB (.edb)
    // ═══════════════════════════════════════════════════════════════════════
    info!("\n━━━ STAGE 3/5: Building Encrypted City Vector Database ━━━");
    build_city_vdb_from_db(&ctx.db, &args.output, &ctx.database_path).await?;

    // ═══════════════════════════════════════════════════════════════════════
    // STAGE 4/5 + 4b: Download Boundaries + Collect Hexagons
    // ═══════════════════════════════════════════════════════════════════════
    if !args.skip_hexagons {
        stage_download_boundaries(ctx, &args).await?;
        stage_collect_hexagons(ctx, &args).await?;
    } else {
        info!("\n━━━ STAGE 4/5: Skipped (--skip-hexagons) ━━━");
    }

    // ═══════════════════════════════════════════════════════════════════════
    // STAGE 5/5: Build Encrypted Hex VDB (.edbh)
    // ═══════════════════════════════════════════════════════════════════════
    info!("\n━━━ STAGE 5/5: Building Encrypted Hex Vector Database ━━━");
    stage_build_hex_vdb(ctx, &args).await?;

    let hex_output = args.output.with_file_name("hexagons.edbh");
    if !args.output.exists() {
        return Err(anyhow!(
            "Stage 3 output missing: {:?}. Pipeline is not complete.",
            args.output
        ));
    }
    if !hex_output.exists() {
        return Err(anyhow!(
            "Stage 5 output missing: {:?}. Pipeline is not complete.",
            hex_output
        ));
    }
    let city_size = std::fs::metadata(&args.output)
        .map_err(|e| anyhow!("read {:?}: {}", args.output, e))?
        .len();
    let hex_size = std::fs::metadata(&hex_output)
        .map_err(|e| anyhow!("read {:?}: {}", hex_output, e))?
        .len();
    if city_size == 0 || hex_size == 0 {
        return Err(anyhow!(
            "Output file size invalid (cities.edb={} bytes, hexagons.edbh={} bytes)",
            city_size,
            hex_size
        ));
    }

    // Final summary.
    let hex_stats = ctx.db.get_hex_stats().await?;
    info!("\n🎊 ALL STAGES COMPLETE!");
    info!("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    info!("📁 Output files:");
    info!("   cities.db        — raw collected data");
    info!("   {:?}  — encrypted city 15D vectors", args.output);
    info!(
        "   {:?}  — encrypted hex 15D vectors",
        hex_output
    );
    info!("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    info!("⬡  Valid hexagons:  {}", hex_stats.valid);

    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────────
// Stage helpers
// ─────────────────────────────────────────────────────────────────────────────

async fn stage_collect_cities(ctx: &AppContext, args: &BuildFullArgs) -> Result<()> {
    let cities = parse_cities_file(&args.cities_file, args.limit).await?;
    let total_cities = cities.len();
    info!("📊 Total cities to collect: {}", total_cities);

    let already_collected = ctx.db.get_collected_city_ids().await?;
    let to_collect: Vec<_> = cities
        .into_iter()
        .filter(|c| !already_collected.contains(&c.geoname_id))
        .collect();

    if to_collect.is_empty() {
        info!(
            "✅ All {} cities already collected, skipping...",
            total_cities
        );
        return Ok(());
    }

    info!(
        "🔄 Collecting {} cities ({} already done)",
        to_collect.len(),
        total_cities - to_collect.len()
    );

    let total = to_collect.len();
    let pb = ProgressBar::new(total as u64);
    pb.set_style(
        ProgressStyle::default_bar()
            .template("{spinner:.green} [{elapsed_precise}] [{bar:40.cyan/blue}] {pos}/{len} ({percent}%) {msg}")
            .unwrap()
            .progress_chars("#>-"),
    );

    // Pre-fetch country data (≈195 codes).
    info!("🌍 Pre-fetching country data...");
    let codes: Vec<String> = {
        let mut s = std::collections::HashSet::new();
        for c in &to_collect {
            s.insert(c.country_code.clone());
        }
        s.into_iter().collect()
    };
    let country_count = codes.len();
    let col = Arc::new(Collector::new("eodi.me-collector/1.0", 0.1, 10.0));
    let cpb = ProgressBar::new(country_count as u64);
    cpb.set_style(
        ProgressStyle::default_bar()
            .template("  🌍 Country data: [{bar:40.yellow/blue}] {pos}/{len} {msg}")
            .unwrap()
            .progress_chars("#>-"),
    );
    let country_cache: Arc<std::collections::HashMap<String, Option<String>>> = Arc::new(
        stream::iter(codes.into_iter())
            .map(|code| {
                let col = col.clone();
                let cpb = cpb.clone();
                async move {
                    let url = format!("https://restcountries.com/v3.1/alpha/{}", code);
                    cpb.set_message(code.clone());
                    let result = match col.fetch(&url).await {
                        Ok(d) => Some(String::from_utf8_lossy(&d).to_string()),
                        Err(e) => {
                            warn!("Country fetch failed for {}: {}", code, e);
                            None
                        }
                    };
                    cpb.inc(1);
                    (code, result)
                }
            })
            .buffer_unordered(32)
            .collect::<Vec<_>>()
            .await
            .into_iter()
            .collect(),
    );
    cpb.finish_with_message("✅ done");
    info!("✅ Country data cached: {} countries", country_count);

    // Batch-insert (200 rows per transaction for ~20× throughput).
    let batch_size = args.batch_size.max(1);
    let db_arc = Arc::new(ctx.db.clone());
    let success = Arc::new(AtomicUsize::new(0));
    let stage1_start = std::time::Instant::now();

    let all_city_data: Vec<_> = to_collect
        .into_iter()
        .map(|city| collect_city_data_sync(&country_cache, &city))
        .collect();

    for chunk in all_city_data.chunks(batch_size) {
        match db_arc.insert_city_batch(chunk).await {
            Ok(n) => {
                success.fetch_add(n, Ordering::Relaxed);
            }
            Err(e) => warn!("❌ Batch insert failed: {}", e),
        }
        let done = success.load(Ordering::Relaxed);
        let elapsed = stage1_start.elapsed().as_secs_f64();
        let rate = if elapsed > 0.0 {
            done as f64 / elapsed
        } else {
            0.0
        };
        let remaining = total.saturating_sub(done);
        let eta_s = if rate > 0.0 {
            remaining as f64 / rate
        } else {
            0.0
        };
        pb.set_position(done as u64);
        pb.set_message(format!("{:.0}/s | ETA {:.0}s", rate, eta_s));
    }

    pb.finish_with_message("✅ Cities collected");
    info!("✅ Stage 1 Complete: {} cities saved", success.load(Ordering::Relaxed));
    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────────

async fn stage_download_boundaries(ctx: &AppContext, args: &BuildFullArgs) -> Result<()> {
    info!("\n━━━ STAGE 4/5: Downloading OSM Admin Boundaries ━━━");
    info!("ℹ️  One query per country (~195 total) replaces per-hexagon is_in queries");

    let all_cities = ctx.db.get_all_cities_basic().await?;
    let country_codes = boundary::unique_country_codes(&all_cities);
    info!("🌍 Countries to download: {}", country_codes.len());

    let already = ctx.db.get_downloaded_boundary_countries().await?;
    let pending: Vec<String> = country_codes
        .into_iter()
        .filter(|cc| !already.contains(cc))
        .collect();

    if pending.is_empty() {
        info!("✅ All country boundaries already downloaded");
        return Ok(());
    }

    info!(
        "📥 Downloading {} countries ({} already done)…",
        pending.len(),
        already.len()
    );

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(210))
        .build()?;

    let boundary_pb = ProgressBar::new(pending.len() as u64);
    boundary_pb.set_style(
        ProgressStyle::default_bar()
            .template("{spinner:.green} [{elapsed_precise}] [{bar:40.cyan/blue}] {pos}/{len} ({percent}%) {msg}")
            .unwrap()
            .progress_chars("#>-"),
    );

    let total = pending.len();
    let mut total_saved = 0usize;

    // Download and save one country at a time to avoid OOM from accumulating all polygons.
    for (i, cc) in pending.iter().enumerate() {
        boundary_pb.set_message(format!("{} ({}/{})", cc, i + 1, total));
        boundary_pb.set_position(i as u64);

        let mut attempts = 0u32;
        let mut success = false;

        while attempts < 5 && !success {
            attempts += 1;
            match boundary::download_country_boundaries(&client, cc, &args.overpass_api).await {
                Ok(recs) => {
                    total_saved += recs.len();
                    if let Err(e) = ctx.db.save_boundaries_chunked(&recs) {
                        warn!("❌ Failed to save boundaries for {}: {}", cc, e);
                    }
                    success = true;
                }
                Err(e) => {
                    let is_rate_limit = e.to_string().contains("429");
                    let wait_secs = if is_rate_limit {
                        60 * attempts as u64
                    } else {
                        10 * attempts as u64
                    };
                    warn!(
                        "⚠️  Boundary download failed for {} (attempt {}): {} — waiting {}s",
                        cc, attempts, e, wait_secs
                    );
                    if attempts < 5 {
                        tokio::time::sleep(std::time::Duration::from_secs(wait_secs)).await;
                    }
                }
            }
        }

        if !success {
            warn!("❌ Skipping {} after 5 failed attempts", cc);
        }

        if i + 1 < total {
            tokio::time::sleep(std::time::Duration::from_millis(3000)).await;
        }
    }

    boundary_pb.finish_with_message("✅ Boundary download complete");

    info!(
        "✅ Stage 4 Complete: {} boundary polygons saved for {} countries",
        total_saved, total,
    );
    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────────

async fn stage_collect_hexagons(ctx: &AppContext, args: &BuildFullArgs) -> Result<()> {
    info!("\n━━━ STAGE 4b/5: Collecting H3 Hexagons (Global Grid-First) ━━━");
    info!("🌐 Strategy: Generate global H3 grid → assign per country (memory-safe)");

    // Load ALL cities (no limit for global grid — we need the full picture).
    let all_cities = ctx.db.get_all_cities_basic().await?;
    let cities_for_grid = if args.limit > 0 && args.limit < all_cities.len() {
        all_cities.into_iter().take(args.limit).collect::<Vec<_>>()
    } else {
        all_cities
    };

    info!("📊 Cities for global grid: {}", cities_for_grid.len());

    // ── Step 1: Generate global deduplicated H3 grid ──
    let global_grid = hexagon::generate_global_hex_grid(&cities_for_grid);

    // ── Step 2: Check what's already in DB for resume ──
    let existing_hex_ids = ctx.db.get_hexagonized_city_ids().await?;
    let already_done = existing_hex_ids.len();

    if already_done > 0 {
        let stats_before = ctx.db.get_hex_stats().await?;
        info!(
            "⏩ Resume: {} cities already hexagonized ({} hexagons in DB)",
            already_done, stats_before.total
        );

        // Check if the existing hexagons were collected with the old per-city
        // approach — if the grid size is significantly larger, re-collect.
        let db_total = stats_before.total;
        let grid_total = global_grid.len();
        if grid_total > db_total + db_total / 10 {
            info!(
                "🔄 Global grid ({}) is significantly larger than DB ({}) — \
                 re-collecting with global-first approach",
                grid_total, db_total
            );
            let deleted = ctx.db.delete_all_hexagons().await?;
            info!("🗑️  Cleared {} old hexagons from DB", deleted);
        } else {
            info!("✅ DB hexagons are up to date — skipping re-collection");
            // Still run integrity check
            return stage_integrity_check(ctx, args).await;
        }
    }

    // ── Step 3: Load hex-level POI data (fall back to city POI keyed by h3_index) ──
    let hex_poi_map = {
        let db_dir = ctx.database_path.parent().unwrap_or(std::path::Path::new("."));
        let hex_poi = crate::pbf::load_all_hex_poi_checkpoints_with_fallback(db_dir)?;
        if !hex_poi.is_empty() {
            info!("✅ Loaded {} H3 cells with direct POI data", hex_poi.len());
            hex_poi
        } else {
            // No hex-level POI checkpoint files — derive from city POI data.
            // Build city_id → POI map, then map each hex's parent_city_id to its POI.
            warn!("⚠️  No hex POI checkpoint data found — deriving from city POI (parent_city_id)");
            let city_poi = ctx.db.get_city_poi_map().await?;
            info!("📊 City POI map loaded: {} cities", city_poi.len());
            let derived: std::collections::HashMap<u64, crate::poi::PoiCounts> = global_grid
                .iter()
                .filter_map(|hex| {
                    city_poi
                        .get(&hex.parent_city_id)
                        .map(|poi| (hex.h3_index, poi.clone()))
                })
                .collect();
            info!("📊 Derived POI for {} hexagons from city data", derived.len());
            derived
        }
    };

    // ── Step 4: Assign data to global grid (country-scoped boundary loading) ──
    let records = hexagon::assign_global_hexagons_by_country(
        &global_grid,
        &hex_poi_map,
        &ctx.db,
    ).await?;

    let valid_count = records.iter().filter(|r| r.is_valid).count();
    let total_count = records.len();

    // ── Step 5: Batch save ──
    info!("💾 Saving {} hexagons to DB…", total_count);
    let save_pb = ProgressBar::new((total_count / 5000 + 1) as u64);
    save_pb.set_style(
        ProgressStyle::default_bar()
            .template("{spinner:.green} Saving hexagons [{bar:40}] {pos}/{len}")
            .unwrap()
            .progress_chars("#>-"),
    );

    for chunk in records.chunks(5000) {
        ctx.db.upsert_hexagons(chunk).await?;
        save_pb.inc(1);
    }
    save_pb.finish_and_clear();

    info!(
        "✅ Stage 4b Complete: {} hexagons saved, {} valid (POI ≥{})",
        total_count,
        valid_count,
        hexagon::MIN_POI_THRESHOLD,
    );

    // ── Step 6: Integrity check — detect and fix gaps ──
    stage_integrity_check(ctx, args).await
}

// ─────────────────────────────────────────────────────────────────────────────

/// Post-collection integrity check: detect and repair data gaps.
///
/// 1. Check for hexagons with `admin_level == 0` (missing boundary data)
/// 2. Identify countries missing boundary polygons
/// 3. Re-download boundaries for gap countries
/// 4. Re-assign admin names for gap hexagons
async fn stage_integrity_check(ctx: &AppContext, args: &BuildFullArgs) -> Result<()> {
    info!("\n━━━ INTEGRITY CHECK: Detecting data gaps ━━━");

    let report = ctx.db.get_hex_integrity_report().await?;

    info!("📊 Integrity Report:");
    info!("   Total hexagons:         {}", report.total_hexagons);
    info!("   Valid hexagons:         {}", report.valid_hexagons);
    info!("   Missing admin (lvl=0): {}", report.missing_admin);
    info!("   Missing POI data:      {}", report.missing_poi);
    info!(
        "   Gap boundary countries: {} {:?}",
        report.gap_boundary_countries.len(),
        &report.gap_boundary_countries[..report.gap_boundary_countries.len().min(10)],
    );
    info!(
        "   Gap admin countries:    {} {:?}",
        report.gap_admin_countries.len(),
        &report.gap_admin_countries[..report.gap_admin_countries.len().min(10)],
    );

    if report.missing_admin == 0 {
        info!("✅ No data gaps detected — all hexagons have admin boundary names");
        return Ok(());
    }

    // ── Re-download boundaries for gap countries ──
    let countries_to_download: Vec<String> = report
        .gap_boundary_countries
        .iter()
        .chain(report.gap_admin_countries.iter())
        .cloned()
        .collect::<std::collections::HashSet<_>>()
        .into_iter()
        .collect();

    if !countries_to_download.is_empty() {
        info!(
            "📥 Re-downloading boundaries for {} gap countries…",
            countries_to_download.len()
        );

        // Delete old boundary data for these countries so we get fresh data
        for cc in &countries_to_download {
            let _ = ctx.db.delete_boundaries_for_country(cc).await;
        }

        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(210))
            .build()?;

        let dl_pb = ProgressBar::new(countries_to_download.len() as u64);
        dl_pb.set_style(
            ProgressStyle::default_bar()
                .template("{spinner:.green} [{bar:40.cyan/blue}] {pos}/{len} {msg}")
                .unwrap()
                .progress_chars("#>-"),
        );

        let gap_boundaries = boundary::download_all_boundaries(
            &client,
            &countries_to_download,
            &args.overpass_api,
            |done, _total, cc| {
                dl_pb.set_message(cc.to_string());
                dl_pb.set_position(done as u64);
            },
        )
        .await;

        let total_boundaries_saved = gap_boundaries.len();
        if let Err(e) = ctx.db.save_boundaries_chunked(&gap_boundaries) {
            warn!("❌ Failed to save gap boundaries: {}", e);
        }
        dl_pb.finish_with_message("✅ Gap boundary download complete");
        info!("📊 Downloaded {} new boundary polygons", total_boundaries_saved);
    }

    // ── Re-assign admin boundaries for gap hexagons (country-by-country) ──
    if report.missing_admin > 0 {
        info!(
            "🔄 Re-assigning admin boundaries for {} gap hexagons…",
            report.missing_admin
        );

        // Get distinct country codes from actual gap hexagons
        let gap_ccs = ctx.db.get_gap_hexagon_countries().await?;
        info!("📋 {} countries have gap hexagons", gap_ccs.len());

        let mut total_fixed = 0usize;
        let mut total_gaps = 0usize;
        let mut failed_countries: Vec<String> = Vec::new();

        for (i, cc) in gap_ccs.iter().enumerate() {
            // Load boundaries for just this country
            let boundary_index = match ctx.db.build_boundary_index_for_countries(&[cc.clone()]).await {
                Ok(idx) => idx,
                Err(e) => {
                    warn!("⚠️  [{}] boundary index build failed: {}", cc, e);
                    failed_countries.push(cc.clone());
                    continue;
                }
            };
            if boundary_index.len() == 0 {
                continue;
            }
            // Load gap hexagons for just this country
            let mut gap_hexagons = match ctx.db.load_gap_hexagons_for_country(cc).await {
                Ok(rows) => rows,
                Err(e) => {
                    warn!("⚠️  [{}] loading gap hexagons failed: {}", cc, e);
                    failed_countries.push(cc.clone());
                    continue;
                }
            };
            if gap_hexagons.is_empty() {
                continue;
            }
            let count = gap_hexagons.len();
            let fixed = hexagon::reassign_admin_for_gaps(&mut gap_hexagons, &boundary_index);
            total_gaps += count;
            total_fixed += fixed;

            if fixed > 0 {
                let fixed_records: Vec<_> = gap_hexagons
                    .into_iter()
                    .filter(|r| r.admin_level > 0)
                    .collect();
                for chunk in fixed_records.chunks(5000) {
                    if let Err(e) = ctx.db.upsert_hexagons(chunk).await {
                        warn!("⚠️  [{}] upsert failed: {}", cc, e);
                        failed_countries.push(cc.clone());
                        break;
                    }
                }
            }
            // boundary_index dropped here — memory freed

            if (i + 1) % 10 == 0 || i + 1 == gap_ccs.len() {
                info!("   [{}/{}] processed, {} fixed so far", i + 1, gap_ccs.len(), total_fixed);
            }
        }

        info!(
            "🔧 Fixed {}/{} gap hexagons ({:.1}%)",
            total_fixed,
            total_gaps,
            if total_gaps == 0 { 0.0 } else { total_fixed as f64 / total_gaps as f64 * 100.0 }
        );
        if !failed_countries.is_empty() {
            failed_countries.sort();
            failed_countries.dedup();
            warn!(
                "⚠️  {} country(ies) had repair errors and were skipped: {:?}",
                failed_countries.len(),
                failed_countries
            );
        }

        // Final check
        let final_report = ctx.db.get_hex_integrity_report().await?;
        if final_report.missing_admin > 0 {
            warn!(
                "⚠️  {} hexagons still have admin_level=0 after repair \
                 (boundary data unavailable for some regions)",
                final_report.missing_admin
            );
        } else {
            info!("✅ All hexagons now have proper admin boundary names!");
        }
    }

    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────────

async fn stage_build_hex_vdb(ctx: &AppContext, args: &BuildFullArgs) -> Result<()> {
    let mut raw_hexes = ctx.db.load_valid_hexagons().await?;
    info!("📊 Valid hexagons loaded: {}", raw_hexes.len());

    if raw_hexes.is_empty() {
        // Safety repair #1: backfill poi_data from parent city's POI when all hexagons
        // have total_poi=0 (happens when assign_global_hexagons_by_country ran without
        // .hex_poi_ckpt files). This is the common case when Stage 2 city POI was
        // collected but no hex-level checkpoint was saved.
        let hex_stats = ctx.db.get_hex_stats().await?;
        if hex_stats.total > 0 {
            warn!(
                "⚠️  {} hexagons in DB but valid=0 — backfilling poi_data from city data...",
                hex_stats.total
            );
            let updated = ctx
                .db
                .backfill_hex_poi_from_city_data(crate::hexagon::MIN_POI_THRESHOLD)
                .await?;
            info!("🔧 Backfilled POI data — {} hexagons now valid", updated);
        }

        // Safety repair #2: recompute is_valid from stored POI JSON (handles stale flags).
        warn!("⚠️  Recomputing validity from POI...");
        let changed = ctx
            .db
            .recompute_hex_validity_from_poi(crate::hexagon::MIN_POI_THRESHOLD)
            .await?;
        info!("🔧 Recomputed hex validity flags — changed {} rows", changed);

        // Report integrity summary to help debugging.
        let report = ctx.db.get_hex_integrity_report().await?;
        info!(
            "📋 Hex integrity after recompute: total={}, valid={}, missing_admin={}, missing_poi={} ",
            report.total_hexagons,
            report.valid_hexagons,
            report.missing_admin,
            report.missing_poi
        );

        // Reload valid hexagons and continue if any are available.
        raw_hexes = ctx.db.load_valid_hexagons().await?;
        info!("📊 Valid hexagons reloaded: {}", raw_hexes.len());
        if raw_hexes.is_empty() {
            return Err(anyhow!(
                "No valid hexagons found after safety repairs. Run 'eodi-collector repair' and then 'collect-hexagons' (or re-run full pipeline) to fill POI/boundary gaps, then retry building the hex VDB."
            ));
        } else {
            info!("✅ Proceeding with {} valid hexagons after repair", raw_hexes.len());
        }
    }

    let hex_stats = normalizer::GlobalHexStats::compute(&raw_hexes);
    let hex_vectors = normalizer::compute_all_hex_vectors(&raw_hexes, &hex_stats);
    info!("✅ Computed {} hexagon vectors", hex_vectors.len());

    let hex_vdb = vectordb::HexVectorDatabase::new(hex_vectors);
    let hex_output = args.output.with_file_name("hexagons.edbh");

    if let Some(parent) = hex_output.parent() {
        std::fs::create_dir_all(parent)?;
    }
    hex_vdb.encrypt_to_file(&hex_output)?;

    let file_size = std::fs::metadata(&hex_output)?.len();
    info!(
        "✅ Hex VDB saved: {:?} ({:.2} MB)",
        hex_output,
        file_size as f64 / 1_048_576.0
    );
    info!("🎯 Hex Sigma²: {:.6}", hex_vdb.sigma_squared);
    Ok(())
}
