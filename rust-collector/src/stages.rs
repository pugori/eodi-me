use anyhow::Result;
use std::sync::{Arc, atomic::{AtomicUsize, Ordering}};
use std::path::Path;
use std::collections::HashMap;
use tracing::{info, warn};
use indicatif::{ProgressBar, ProgressStyle};
use crate::{pbf, ratelimit, database::CityDatabase};
use crate::database::PoiClimateUpdate;

fn raw_stage_ckpt_path(poi_ckpt_path: &Path) -> std::path::PathBuf {
    poi_ckpt_path.with_extension("raw_stage2")
}

fn save_raw_stage_checkpoint(path: &Path, rows: &[PoiClimateUpdate]) -> Result<()> {
    let bytes = bincode::serialize(rows)?;
    std::fs::write(path, bytes)?;
    info!(
        "💾 Raw stage checkpoint saved ({:.1} MB): {:?}",
        path.metadata().map(|m| m.len()).unwrap_or(0) as f64 / 1_048_576.0,
        path.file_name().unwrap_or_default()
    );
    Ok(())
}

fn load_raw_stage_checkpoint(path: &Path) -> Result<Option<Vec<PoiClimateUpdate>>> {
    match std::fs::read(path) {
        Ok(bytes) => {
            let rows: Vec<PoiClimateUpdate> = bincode::deserialize(&bytes)?;
            info!(
                "♻️  Reusing raw stage checkpoint ({}) from {:?}",
                rows.len(),
                path.file_name().unwrap_or_default()
            );
            Ok(Some(rows))
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.into()),
    }
}

fn delete_raw_stage_checkpoint(path: &Path) {
    let _ = std::fs::remove_file(path);
}

fn region_url_for_city(city: &crate::city::CityBasic) -> &'static str {
    if city.country_code == "US" {
        let (_, url) = pbf::us_subregion_url(city.latitude, city.longitude);
        url
    } else {
        let (_, url) = pbf::geofabrik_region(&city.country_code);
        url
    }
}

fn select_cities_compact_by_region(
    pending: Vec<crate::city::CityBasic>,
    limit: usize,
) -> Vec<crate::city::CityBasic> {
    if limit == 0 || pending.len() <= limit {
        return pending;
    }

    let mut groups: HashMap<&'static str, Vec<crate::city::CityBasic>> = HashMap::new();
    for city in pending {
        groups.entry(region_url_for_city(&city)).or_default().push(city);
    }

    let mut grouped: Vec<Vec<crate::city::CityBasic>> = groups.into_values().collect();
    grouped.sort_by_key(|g| std::cmp::Reverse(g.len()));

    let mut selected = Vec::with_capacity(limit);
    for mut group in grouped {
        if selected.len() >= limit {
            break;
        }
        let take_n = (limit - selected.len()).min(group.len());
        selected.extend(group.drain(..take_n));
    }
    selected
}

/// STAGE 2/3: Collect POI Data (PBF)
pub async fn execute_stage_poi(
    db: &CityDatabase,
    limit: usize,
    skip_poi: bool,
    concurrency: usize,
    database_path: &Path,
) -> Result<()> {
    if skip_poi {
        info!("\n━━━ STAGE 2/3: Skipped (--skip-poi) ━━━");
        return Ok(());
    }

    info!("\n━━━ STAGE 2/3: Collecting POI Data (PBF mode) ━━━");

    let pending = db.get_cities_without_poi().await?;
    let total_in_db = db.get_all_cities_basic().await?.len();
    let skipped = total_in_db.saturating_sub(pending.len());
    if skipped > 0 {
        info!("⏩ Resuming — skipping {} already-collected cities", skipped);
    }

    let cities_to_process = select_cities_compact_by_region(pending, limit);

    if cities_to_process.is_empty() {
        info!("✅ Stage 2 already complete — all cities have POI data.");
        return Ok(());
    }

    let batches = pbf::group_by_region(cities_to_process);
    info!("📦 {} Geofabrik region(s) to process", batches.len());

    let pbf_dir = database_path.parent().unwrap_or(Path::new(".")).to_path_buf();

    let http_client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(3600))
        .connect_timeout(std::time::Duration::from_secs(30))
        .user_agent("eodi-collector/1.0 (+https://eodi.me)")
        .gzip(true)
        .build()?;

    let total_cities: usize = batches.iter().map(|b| b.cities.len()).sum();
    let progress_bar = ProgressBar::new(total_cities as u64);
    progress_bar.set_style(
        ProgressStyle::default_bar()
            .template("{spinner:.green} [{elapsed_precise}] [{bar:40.cyan/blue}] {pos}/{len} ({percent}%) ETA {eta} {msg}")
            .unwrap()
            .progress_chars("#>-"),
    );

    let success_count = Arc::new(AtomicUsize::new(0));
    let fail_count    = Arc::new(AtomicUsize::new(0));

    let _overpass_rl = Arc::new(ratelimit::DomainRateLimiter::new(0.1, 60.0));

    'batch_loop: for (batch_idx, batch) in batches.iter().enumerate() {
        let batch_start = std::time::Instant::now();
        info!("🌍 [{}/{}] {} — {} cities", batch_idx + 1, batches.len(), batch.label, batch.cities.len());

        let pbf_path = pbf::pbf_tmp_path(&pbf_dir, batch.label);
        let ckpt_path = pbf::poi_checkpoint_path(&pbf_dir, batch.label);
        let raw_ckpt_path = raw_stage_ckpt_path(&ckpt_path);
        let ts_path = pbf::ckpt_ts_path(&ckpt_path);

        // 1. Checkpoint Check
        let poi_map_from_ckpt: Option<HashMap<i64, _>> = match pbf::load_poi_checkpoint(&ckpt_path) {
            Ok(Some(map)) => {
                let saved_ts = pbf::load_ckpt_timestamp(&ts_path);
                let remote_ts = pbf::remote_last_modified(&http_client, batch.url).await;
                let is_fresh = match (saved_ts, remote_ts) {
                    (Some(saved), Some(remote)) if remote > saved => {
                        info!("  🔄 Geofabrik PBF updated — re-downloading");
                        pbf::delete_poi_checkpoint(&ckpt_path);
                        false
                    }
                    (None, _) => {
                         info!("  🔄 No timestamp sidecar — re-downloading");
                         pbf::delete_poi_checkpoint(&ckpt_path);
                         false
                    }
                    (_, None) => {
                        info!("  ⚡ HEAD failed — trusting checkpoint");
                        true
                    }
                    _ => true
                };
                if is_fresh { Some(map) } else { None }
            }
            Ok(None) => None,
            Err(e) => {
                warn!("  ⚠️  Checkpoint unreadable: {}", e);
                None
            }
        };

        let poi_map = if let Some(map) = poi_map_from_ckpt {
            map
        } else {
            // 2. Download + Extract (with up to 2 attempts on corrupt PBF)
            let mut final_extracted = HashMap::new();
            let mut extract_succeeded = false;

            for attempt in 0u32..2 {
                if attempt > 0 {
                    warn!("  🔄 PBF was corrupt — re-downloading (attempt {})", attempt + 1);
                }

                match pbf::download_pbf_with_retry(&http_client, batch.url, &pbf_path, batch.label).await {
                    Ok((bytes, last_modified)) => {
                        info!("  ✅ PBF ready ({:.1} MB)", bytes as f64 / 1_048_576.0);
                        if let Some(ts) = last_modified {
                            pbf::save_ckpt_timestamp(&ts_path, ts);
                        }
                    }
                    Err(e) => {
                        warn!("  ⚠️  PBF download failed: {}", e);
                        for (_, _, _, _, city_name, country_code) in &batch.meta {
                            fail_count.fetch_add(1, Ordering::Relaxed);
                            progress_bar.inc(1);
                            progress_bar.set_message(format!("skip {} ({})", city_name, country_code));
                        }
                        continue 'batch_loop;
                    }
                }

                // 3. Extract (CPU-bound)
                let pbf_path_b = pbf_path.clone();
                let cities_b = batch.cities.clone();
                let processed_b = Arc::new(AtomicUsize::new(0));
                let proc_clone = processed_b.clone();

                let pb_clone = progress_bar.clone();
                let proc_monitor = processed_b.clone();
                let cities_count = batch.cities.len();
                let batch_label = batch.label.to_string();

                let monitor = tokio::spawn(async move {
                    let mut last = 0;
                    let mut stagnant_ticks = 0usize;
                    loop {
                        tokio::time::sleep(std::time::Duration::from_secs(2)).await;
                        let current = proc_monitor.load(Ordering::Relaxed);
                        let pct = (current as f64 / cities_count as f64 * 100.0) as usize;
                        pb_clone.set_message(format!("🔍 {} — scanned {}/{} cities ({}%)", batch_label, current, cities_count, pct));
                        if current > last {
                            stagnant_ticks = 0;
                            last = current;
                        } else {
                            stagnant_ticks += 1;
                            if stagnant_ticks.is_multiple_of(15) {
                                info!(
                                    "  ⏱️  Scan heartbeat {}: {}/{} cities ({}%)",
                                    batch_label,
                                    current,
                                    cities_count,
                                    pct
                                );
                            }
                        }
                        if current >= cities_count { break; }
                    }
                });

                progress_bar.set_message(format!("🔍 scanning PBF for {}…", batch.label));

                let extract_result = tokio::task::spawn_blocking(move || {
                    pbf::extract_poi_from_pbf(&pbf_path_b, &cities_b, &proc_clone)
                }).await;

                monitor.abort();

                match extract_result {
                    Ok(Ok(m)) => {
                        info!("  ✅ Scanned {} cities from PBF", processed_b.load(Ordering::Relaxed));
                        pbf::delete_pbf(&pbf_path);
                        final_extracted = m;
                        extract_succeeded = true;
                        break;
                    }
                    Ok(Err(e)) => {
                        warn!("  ⚠️  PBF extract failed (attempt {}): {}", attempt + 1, e);
                        pbf::delete_pbf(&pbf_path);
                        // loop will retry if attempt < 1, else fall through
                    }
                    Err(e) => {
                        warn!("  ⚠️  PBF task panicked (attempt {}): {}", attempt + 1, e);
                        pbf::delete_pbf(&pbf_path);
                    }
                }
            }

            if extract_succeeded {
                if let Err(e) = pbf::save_poi_checkpoint(&ckpt_path, &final_extracted) {
                    warn!("  ⚠️  Could not save checkpoint: {}", e);
                }
            } else {
                warn!("  ⚠️  PBF extract failed after 2 attempts — proceeding with empty POI map");
            }
            final_extracted
        };

        // 4) Collect source objects first, persist raw checkpoint, then load DB.
        let updates: Vec<PoiClimateUpdate> = if let Some(rows) = load_raw_stage_checkpoint(&raw_ckpt_path)? {
            rows
        } else {
            let rows: Vec<PoiClimateUpdate> = batch
                .meta
                .iter()
                .map(|(geoname_id, _, _, _, _, _)| PoiClimateUpdate {
                    geoname_id: *geoname_id,
                    poi_data: poi_map.get(geoname_id).cloned(),
                })
                .collect();

            save_raw_stage_checkpoint(&raw_ckpt_path, &rows)?;
            rows
        };

        match db.update_poi_climate_batch(&updates).await {
            Ok(saved_n) => {
                success_count.fetch_add(saved_n, Ordering::Relaxed);
                progress_bar.inc(saved_n as u64);
                progress_bar.set_message(format!("💾 {} — saved {} rows", batch.label, saved_n));
                delete_raw_stage_checkpoint(&raw_ckpt_path);
            }
            Err(e) => {
                warn!("Batch DB save failed for {}: {}", batch.label, e);
                for (geoname_id, _, _, _, city_name, country_code) in &batch.meta {
                    let poi_data = poi_map.get(geoname_id);
                    match db.update_poi_climate(*geoname_id, poi_data, None, None, None).await {
                        Ok(_) => { success_count.fetch_add(1, Ordering::Relaxed); }
                        Err(e) => {
                            fail_count.fetch_add(1, Ordering::Relaxed);
                            warn!("DB save failed for {}: {}", city_name, e);
                        }
                    }
                    progress_bar.inc(1);
                    progress_bar.set_message(format!("{} ({})", city_name, country_code));
                }
                delete_raw_stage_checkpoint(&raw_ckpt_path);
            }
        }

        let elapsed = batch_start.elapsed();
        let success = success_count.load(Ordering::Relaxed);
        let failed = fail_count.load(Ordering::Relaxed);
        info!("  {} saved, {} failed — batch done in {:.0}s", success, failed, elapsed.as_secs_f64());

        // Batch done, delete checkpoint
        pbf::delete_poi_checkpoint(&ckpt_path);
    } // end batch loop

    progress_bar.finish_with_message("✅ POI collected");
    info!("✅ Stage 2 Complete: {} saved, {} failed",
          success_count.load(Ordering::Relaxed),
          fail_count.load(Ordering::Relaxed));

    Ok(())
}
