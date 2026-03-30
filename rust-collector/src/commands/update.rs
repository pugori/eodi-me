//! Auto-mode comprehensive integrity check + gap repair.
//!
//! Triggered automatically when running eodi-collector without arguments
//! and existing data is detected in the DB.
//!
//! Checks ALL data layers in order:
//!   Phase 1 — Cities:     new entries in GeoNames? invalid records?
//!   Phase 2 — POI:        cities missing poi_data?
//!   Phase 3 — Boundaries: countries without OSM admin polygons?
//!   Phase 4 — Hexagons:   admin_level=0 gaps? missing POI?
//!   Phase 5 — VDB:        rebuild .edb / .edbh if any data changed

use anyhow::Result;
use futures::stream::StreamExt;
use indicatif::{ProgressBar, ProgressStyle};
use std::path::PathBuf;
use tracing::{info, warn};

use crate::boundary;
use crate::collector::Collector;
use crate::commands::AppContext;
use crate::hexagon;
use crate::normalizer;
use crate::pbf;
use crate::pipeline::cities::{collect_city_data_sync, parse_cities_file};
use crate::pipeline::vdb::build_city_vdb_from_db;
use crate::stages;
use crate::vectordb;

pub struct UpdateArgs {
    pub overpass_api: String,
    pub force: bool,
}

pub async fn run(ctx: &AppContext, args: UpdateArgs) -> Result<()> {
    info!("🔄 Comprehensive Integrity Check & Gap Repair");
    info!("📂 Database: {:?}", ctx.database_path);

    // ── Force mode: clear everything and rebuild ──
    if args.force {
        info!("⚠️  Force mode: clearing all hexagons and re-collecting");
        let deleted = ctx.db.delete_all_hexagons().await?;
        info!("🗑️  Deleted {} hexagons", deleted);
        return run_full_recollection(ctx, &args.overpass_api).await;
    }

    // ── Locate cities file ──
    let cities_file = find_cities_file();

    // ── Run comprehensive integrity report ──
    let output_dir = ctx.output_path.clone();
    let report = ctx
        .db
        .get_full_integrity_report(cities_file.as_deref(), &output_dir)
        .await?;

    // ── Print diagnostic summary ──
    println!();
    println!("╔══════════════════════════════════════════════════════╗");
    println!("║             Integrity Report — All Layers            ║");
    println!("╚══════════════════════════════════════════════════════╝");

    info!("━━━ Layer 1: Cities ━━━");
    info!("   Total in DB:         {}", report.cities_total);
    info!("   Invalid (no country):{}", report.cities_invalid);
    info!("   New in GeoNames:     {}", report.cities_new_in_file);

    info!("━━━ Layer 2: POI ━━━");
    info!("   Missing POI data:    {}", report.cities_without_poi);

    info!("━━━ Layer 3: Boundaries ━━━");
    info!(
        "   Countries done:      {}",
        report.boundary_countries_done
    );
    info!(
        "   Countries missing:   {} {:?}",
        report.boundary_countries_missing.len(),
        &report.boundary_countries_missing,
    );

    info!("━━━ Layer 4: Hexagons ━━━");
    info!("   Total hexagons:      {}", report.hex.total_hexagons);
    info!("   Valid hexagons:      {}", report.hex.valid_hexagons);
    info!("   Missing admin (=0):  {}", report.hex.missing_admin);
    info!("   Missing POI data:    {}", report.hex.missing_poi);

    info!("━━━ Layer 5: VDB Files ━━━");
    info!(
        "   cities.edb:          {}",
        if report.city_vdb_exists { "✅" } else { "❌ missing" }
    );
    info!(
        "   hexagons.edbh:       {}",
        if report.hex_vdb_exists { "✅" } else { "❌ missing" }
    );

    if report.is_complete() {
        info!("\n✅ All data layers are complete — nothing to update");
        return Ok(());
    }

    // Track whether any layer was repaired (for VDB rebuild decision)
    let mut city_data_changed = false;
    let mut hex_data_changed = false;

    // ═════════════════════════════════════════════════════════════════════
    // PHASE 1: Cities — collect new entries from GeoNames
    // ═════════════════════════════════════════════════════════════════════
    if report.cities_new_in_file > 0 {
        if let Some(ref cf) = cities_file {
            info!(
                "\n━━━ Phase 1: Collecting {} new cities from GeoNames ━━━",
                report.cities_new_in_file
            );

            let existing_ids = ctx.db.get_collected_city_ids().await?;
            let all_parsed = parse_cities_file(cf, 0).await?;
            let new_basics: Vec<_> = all_parsed
                .into_iter()
                .filter(|c| !existing_ids.contains(&c.geoname_id))
                .collect();

            if !new_basics.is_empty() {
                info!("📥 {} new cities to collect", new_basics.len());

                // Pre-fetch country data for new country codes
                let unique_codes: std::collections::HashSet<String> =
                    new_basics.iter().map(|c| c.country_code.clone()).collect();
                let country_col = std::sync::Arc::new(Collector::new(
                    "eodi.me-collector/1.0",
                    0.1,
                    10.0,
                ));
                let country_cache: std::collections::HashMap<String, Option<String>> =
                    futures::stream::iter(unique_codes.into_iter())
                        .map(|code| {
                            let col = country_col.clone();
                            async move {
                                let url = format!(
                                    "https://restcountries.com/v3.1/alpha/{}",
                                    code
                                );
                                let result = col
                                    .fetch(&url)
                                    .await
                                    .map(|d| String::from_utf8_lossy(&d).to_string())
                                    .ok();
                                (code, result)
                            }
                        })
                        .buffer_unordered(16)
                        .collect::<Vec<_>>()
                        .await
                        .into_iter()
                        .collect();

                // Build CityData and batch insert
                let city_data_vec: Vec<_> = new_basics
                    .iter()
                    .map(|c| collect_city_data_sync(&country_cache, c))
                    .collect();
                let saved = ctx.db.insert_city_batch(&city_data_vec).await?;
                info!("✅ Saved {} new cities to DB", saved);
                city_data_changed = true;
            }
        }
    }

    // ── Re-validate invalid cities ──
    if report.cities_invalid > 0 {
        info!(
            "\n🔧 {} invalid cities detected (missing country_info)",
            report.cities_invalid
        );
        let invalid_ids = ctx.db.find_invalid_cities().await?;
        let invalid_basics = ctx.db.get_cities_by_ids(&invalid_ids).await?;

        if !invalid_basics.is_empty() {
            info!(
                "   Re-collecting country info for {} cities…",
                invalid_basics.len()
            );

            let unique_codes: std::collections::HashSet<String> =
                invalid_basics.iter().map(|c| c.country_code.clone()).collect();
            let country_col = std::sync::Arc::new(Collector::new(
                "eodi.me-collector/1.0",
                0.1,
                10.0,
            ));
            let country_cache: std::collections::HashMap<String, Option<String>> =
                futures::stream::iter(unique_codes.into_iter())
                    .map(|code| {
                        let col = country_col.clone();
                        async move {
                            let url = format!(
                                "https://restcountries.com/v3.1/alpha/{}",
                                code
                            );
                            let result = col
                                .fetch(&url)
                                .await
                                .map(|d| String::from_utf8_lossy(&d).to_string())
                                .ok();
                            (code, result)
                        }
                    })
                    .buffer_unordered(16)
                    .collect::<Vec<_>>()
                    .await
                    .into_iter()
                    .collect();

            let city_data_vec: Vec<_> = invalid_basics
                .iter()
                .map(|c| collect_city_data_sync(&country_cache, c))
                .collect();
            let saved = ctx.db.insert_city_batch(&city_data_vec).await?;
            info!("✅ Re-saved {} invalid cities with country info", saved);
            city_data_changed = true;
        }
    }

    // ═════════════════════════════════════════════════════════════════════
    // PHASE 2: POI — collect POI data for cities that lack it
    // ═════════════════════════════════════════════════════════════════════
    if report.cities_without_poi > 0 {
        info!(
            "\n━━━ Phase 2: Collecting POI for {} cities ━━━",
            report.cities_without_poi
        );

        stages::execute_stage_poi(
            &ctx.db,
            0, // no limit — collect ALL missing
            false,
            2023,
            6,
            &ctx.database_path,
        )
        .await?;

        city_data_changed = true;
    }

    // ═════════════════════════════════════════════════════════════════════
    // PHASE 3: Boundaries — download missing country boundaries
    // ═════════════════════════════════════════════════════════════════════
    if !report.boundary_countries_missing.is_empty() {
        info!(
            "\n━━━ Phase 4: Downloading boundaries for {} countries ━━━",
            report.boundary_countries_missing.len()
        );

        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(210))
            .build()?;

        let dl_pb = ProgressBar::new(report.boundary_countries_missing.len() as u64);
        dl_pb.set_style(
            ProgressStyle::default_bar()
                .template("{spinner:.green} [{bar:40.cyan/blue}] {pos}/{len} {msg}")
                .unwrap()
                .progress_chars("#>-"),
        );

        let mut total_saved = 0usize;

        let _stats = boundary::download_all_boundaries(
            &client,
            &report.boundary_countries_missing,
            &args.overpass_api,
            |done, _total, cc| {
                dl_pb.set_message(cc.to_string());
                dl_pb.set_position(done as u64);
            },
            |cc, recs| {
                let n = recs.len();
                if n == 0 {
                    return;
                }
                match ctx.db.save_boundaries_chunked(&recs) {
                    Ok(()) => total_saved += n,
                    Err(e) => warn!("❌ {}: {}", cc, e),
                }
            },
        )
        .await;

        dl_pb.finish_with_message("✅ done");
        info!("📊 Downloaded {} new boundary polygons", total_saved);
        hex_data_changed = true;
    }

    // ── Also re-download boundaries for countries with admin gaps ──
    let gap_admin_countries: Vec<String> = report
        .hex
        .gap_admin_countries
        .iter()
        .filter(|cc| !report.boundary_countries_missing.contains(cc))
        .cloned()
        .collect();

    if !gap_admin_countries.is_empty() {
        info!(
            "\n📥 Re-downloading boundaries for {} admin-gap countries…",
            gap_admin_countries.len()
        );

        for cc in &gap_admin_countries {
            let deleted = ctx.db.delete_boundaries_for_country(cc).await?;
            if deleted > 0 {
                info!("   🗑️  Cleared {} old boundaries for {}", deleted, cc);
            }
        }

        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(210))
            .build()?;

        let mut total_saved = 0usize;

        let _stats = boundary::download_all_boundaries(
            &client,
            &gap_admin_countries,
            &args.overpass_api,
            |_done, _total, _cc| {},
            |cc, recs| {
                let n = recs.len();
                if n == 0 {
                    return;
                }
                match ctx.db.save_boundaries_chunked(&recs) {
                    Ok(()) => total_saved += n,
                    Err(e) => warn!("❌ {}: {}", cc, e),
                }
            },
        )
        .await;

        info!("📊 Downloaded {} boundary polygons for gap repair", total_saved);
        hex_data_changed = true;
    }

    // ═════════════════════════════════════════════════════════════════════
    // PHASE 5: Hexagons — fix admin gaps + missing POI
    // ═════════════════════════════════════════════════════════════════════
    if report.hex.total_hexagons == 0 {
        // No hexagons at all — run full generation
        info!("\n━━━ Phase 5: No hexagons — running full H3 grid generation ━━━");
        return run_full_recollection(ctx, &args.overpass_api).await;
    }

    if report.hex.missing_admin > 0 {
        info!(
            "\n━━━ Phase 5a: Re-assigning admin for {} gap hexagons ━━━",
            report.hex.missing_admin
        );

        let gap_ccs = ctx.db.get_gap_hexagon_countries().await?;
        info!("📋 {} countries have gap hexagons", gap_ccs.len());

        let mut total_fixed = 0usize;
        let mut total_gaps = 0usize;
        let mut failed_countries: Vec<String> = Vec::new();

        for (i, cc) in gap_ccs.iter().enumerate() {
            let boundary_index = match ctx.db.build_boundary_index_for_countries(&[cc.clone()]).await {
                Ok(idx) => idx,
                Err(e) => {
                    warn!("⚠️  [{}] boundary index build failed: {}", cc, e);
                    failed_countries.push(cc.clone());
                    continue;
                }
            };
            if boundary_index.len() == 0 { continue; }
            let mut gap_hexagons = match ctx.db.load_gap_hexagons_for_country(cc).await {
                Ok(rows) => rows,
                Err(e) => {
                    warn!("⚠️  [{}] loading gap hexagons failed: {}", cc, e);
                    failed_countries.push(cc.clone());
                    continue;
                }
            };
            if gap_hexagons.is_empty() { continue; }
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

            if (i + 1) % 10 == 0 || i + 1 == gap_ccs.len() {
                info!("   [{}/{}] processed, {} fixed so far", i + 1, gap_ccs.len(), total_fixed);
            }
        }

        info!(
            "   Fixed {}/{} gap hexagons ({:.1}%)",
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

        if total_fixed > 0 {
            info!("💾 Saved {} re-assigned hexagons", total_fixed);
            hex_data_changed = true;
        }
    }

    if report.hex.missing_poi > 0 {
        info!(
            "\n━━━ Phase 5b: {} hexagons missing POI — checking checkpoints ━━━",
            report.hex.missing_poi
        );

        let db_dir = ctx
            .database_path
            .parent()
            .unwrap_or(std::path::Path::new("."));
        let hex_poi_map = pbf::load_all_hex_poi_checkpoints_with_fallback(db_dir)?;

        if hex_poi_map.is_empty() {
            warn!("⚠️  No hex POI checkpoint data found — a full rebuild may be needed");
        } else {
            info!("✅ Loaded {} H3 cells with POI from checkpoints", hex_poi_map.len());
            info!("ℹ️  Hex POI gaps typically require re-running PBF extraction");
        }
    }

    // 5c — Safety repair: legacy DBs can have stale `is_valid` flags.
    // Recompute from poi_data so Hex VDB rebuild isn't blocked by valid=0 anomalies.
    let hex_stats_now = ctx.db.get_hex_stats().await?;
    if hex_stats_now.total > 0 && hex_stats_now.valid == 0 {
        warn!(
            "⚠️  Hexagons exist but valid=0. Recomputing is_valid from poi_data (threshold={})",
            crate::hexagon::MIN_POI_THRESHOLD
        );
        let changed = ctx
            .db
            .recompute_hex_validity_from_poi(crate::hexagon::MIN_POI_THRESHOLD)
            .await?;
        let hex_stats_after = ctx.db.get_hex_stats().await?;
        info!(
            "✅ is_valid refresh done (changed≈{}). Valid hexagons: {} -> {}",
            changed,
            hex_stats_now.valid,
            hex_stats_after.valid
        );
        if hex_stats_after.valid > 0 {
            hex_data_changed = true;
        } else {
            let db_dir = ctx
                .database_path
                .parent()
                .unwrap_or(std::path::Path::new("."));
            let ckpt_map = pbf::load_all_hex_poi_checkpoints_with_fallback(db_dir)?;
            if !ckpt_map.is_empty() {
                warn!(
                    "⚠️  valid hexagons still 0 but POI checkpoints exist ({} cells). Rebuilding hexagons from checkpoints…",
                    ckpt_map.len()
                );
                return run_full_recollection(ctx, &args.overpass_api).await;
            } else {
                warn!(
                    "⚠️  valid hexagons still 0 and no POI checkpoints found in fallback paths"
                );
            }
        }
    }

    // ═════════════════════════════════════════════════════════════════════
    // PHASE 6: Rebuild VDB files if any data changed
    // ═════════════════════════════════════════════════════════════════════
    info!("\n━━━ Phase 6: VDB Rebuild Check ━━━");

    // 6a — City VDB (.edb)
    if city_data_changed || !report.city_vdb_exists {
        info!("🔄 Rebuilding City VDB (.edb)…");
        let edb_output = output_dir.join("cities.edb");
        build_city_vdb_from_db(&ctx.db, &edb_output, &ctx.database_path).await?;
    } else {
        info!("✅ City VDB is up to date");
    }

    // 6b — Hex VDB (.edbh)
    if hex_data_changed || !report.hex_vdb_exists {
        info!("🔄 Rebuilding Hex VDB (.edbh)…");
        rebuild_hex_vdb(ctx).await?;
    } else {
        info!("✅ Hex VDB is up to date");
    }

    // 6c — Storage control (avoid runaway DB growth)
    let db_size_bytes = ctx.db.db_file_size_bytes().await.unwrap_or(0);
    let db_size_gb = db_size_bytes as f64 / 1024.0 / 1024.0 / 1024.0;
    if db_size_gb >= 20.0 {
        warn!(
            "⚠️  Large DB detected ({:.2} GB). Running boundary pruning + compaction...",
            db_size_gb
        );

        let keep_ccs = ctx.db.get_gap_hexagon_countries().await.unwrap_or_default();
        if !keep_ccs.is_empty() {
            let deleted = ctx.db.delete_boundaries_not_in(&keep_ccs).await.unwrap_or(0);
            info!(
                "🗑️  Boundary pruning complete: deleted {} rows, keeping {} gap-country set",
                deleted,
                keep_ccs.len()
            );
        }

        if let Err(e) = ctx.db.compact_database_file().await {
            warn!("⚠️  DB compaction failed: {}", e);
        } else {
            let after_bytes = ctx.db.db_file_size_bytes().await.unwrap_or(db_size_bytes);
            info!(
                "✅ DB compaction done: {:.2} GB → {:.2} GB",
                db_size_bytes as f64 / 1024.0 / 1024.0 / 1024.0,
                after_bytes as f64 / 1024.0 / 1024.0 / 1024.0
            );
        }
    }

    // ═════════════════════════════════════════════════════════════════════
    // Final summary
    // ═════════════════════════════════════════════════════════════════════
    let final_report = ctx
        .db
        .get_full_integrity_report(None, &output_dir)
        .await?;

    println!();
    println!("╔══════════════════════════════════════════════════════╗");
    println!("║              Final Integrity Status                  ║");
    println!("╚══════════════════════════════════════════════════════╝");

    info!("   Cities:       {} total, {} invalid", final_report.cities_total, final_report.cities_invalid);
    info!("   POI gaps:     {}", final_report.cities_without_poi);
    info!("   Boundaries:   {} countries done, {} missing",
        final_report.boundary_countries_done,
        final_report.boundary_countries_missing.len()
    );
    info!("   Hexagons:     {} total, {} admin gaps, {} POI gaps",
        final_report.hex.total_hexagons,
        final_report.hex.missing_admin,
        final_report.hex.missing_poi
    );
    info!("   City VDB:     {}", if final_report.city_vdb_exists { "✅" } else { "❌" });
    info!("   Hex VDB:      {}", if final_report.hex_vdb_exists { "✅" } else { "❌" });

    if final_report.is_complete() {
        info!("\n🎉 All data layers are now complete!");
    } else {
        warn!("\n⚠️  Some gaps remain — see above for details");
    }

    Ok(())
}

/// Locate the cities15000.txt file in common locations.
fn find_cities_file() -> Option<PathBuf> {
/// Full re-collection using the global H3-first grid.
async fn run_full_recollection(ctx: &AppContext, overpass_api: &str) -> Result<()> {
    // Ensure boundaries are downloaded
    info!("\n━━━ Step 1: Checking boundary coverage ━━━");
    let all_cities = ctx.db.get_all_cities_basic().await?;

    if all_cities.is_empty() {
        return Err(anyhow::anyhow!(
            "No cities in DB. Run 'build-full' or 'collect-cities' first."
        ));
    }

    let country_codes = boundary::unique_country_codes(&all_cities);
    let already = ctx.db.get_downloaded_boundary_countries().await?;
    let pending: Vec<String> = country_codes
        .into_iter()
        .filter(|cc| !already.contains(cc))
        .collect();

    if !pending.is_empty() {
        info!("📥 Downloading boundaries for {} countries…", pending.len());
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(210))
            .build()?;

        let _stats = boundary::download_all_boundaries(
            &client,
            &pending,
            overpass_api,
            |_done, _total, _cc| {},
            |cc, recs| {
                if !recs.is_empty() {
                    if let Err(e) = ctx.db.save_boundaries_chunked(&recs) {
                        tracing::warn!("❌ {}: {}", cc, e);
                    }
                }
            },
        )
        .await;
    }

    // Load POI data
    info!("\n━━━ Step 2: Loading POI data ━━━");
    let db_dir = ctx.database_path
        .parent()
        .unwrap_or(std::path::Path::new("."));
    let hex_poi_map = pbf::load_all_hex_poi_checkpoints_with_fallback(db_dir)?;
    info!("✅ POI data: {} H3 cells", hex_poi_map.len());

    // Generate global grid
    info!("\n━━━ Step 3: Generating global H3 grid ━━━");
    let global_grid = hexagon::generate_global_hex_grid(&all_cities);

    // Assign data (country-scoped boundary loading — avoids OOM)
    info!("\n━━━ Step 4: Assigning data to grid (country-scoped) ━━━");
    let records = hexagon::assign_global_hexagons_by_country(
        &global_grid,
        &hex_poi_map,
        &ctx.db,
    ).await?;

    let total = records.len();
    let valid = records.iter().filter(|r| r.is_valid).count();

    // Save
    info!("\n━━━ Step 5: Saving to DB ━━━");
    let save_pb = ProgressBar::new((total / 5000 + 1) as u64);
    save_pb.set_style(
        ProgressStyle::default_bar()
            .template("{spinner:.green} Saving [{bar:40}] {pos}/{len}")
            .unwrap()
            .progress_chars("#>-"),
    );
    for chunk in records.chunks(5000) {
        ctx.db.upsert_hexagons(chunk).await?;
        save_pb.inc(1);
    }
    save_pb.finish_and_clear();

    info!("✅ Full re-collection complete: {} hexagons, {} valid", total, valid);

    // Rebuild hex VDB
    rebuild_hex_vdb(ctx).await
}

/// Rebuild the encrypted hexagon vector database (.edbh) from current DB data.
async fn rebuild_hex_vdb(ctx: &AppContext) -> Result<()> {
    let raw_hexes = ctx.db.load_valid_hexagons().await?;
    info!("📊 Valid hexagons for VDB: {}", raw_hexes.len());

    if raw_hexes.is_empty() {
        warn!("⚠️  No valid hexagons — skipping VDB rebuild");
        return Ok(());
    }

    let hex_stats = normalizer::GlobalHexStats::compute(&raw_hexes);
    let hex_vectors = normalizer::compute_all_hex_vectors(&raw_hexes, &hex_stats);
    info!("✅ Computed {} hexagon vectors", hex_vectors.len());

    let hex_vdb = vectordb::HexVectorDatabase::new(hex_vectors);
    let hex_output = ctx.output_path.join("hexagons.edbh");

    if let Some(parent) = hex_output.parent() {
        std::fs::create_dir_all(parent)?;
    }
    hex_vdb.encrypt_to_file(&hex_output)?;

    let file_size = std::fs::metadata(&hex_output)?.len();
    info!(
        "✅ Hex VDB rebuilt: {:?} ({:.2} MB)",
        hex_output,
        file_size as f64 / 1_048_576.0
    );
    Ok(())
}
