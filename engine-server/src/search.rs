//! In-memory search index for hexagon vectors.
//!
//! Provides two search modes:
//! 1. **Text search** (`search`) — substring match on admin_name / city / country
//!    with exact → prefix → contains ranking.
//! 2. **Vector similarity** (`find_similar`) — parallel similarity search over
//!    pre-loaded vectors using Rayon for throughput.
//!
//! # Performance
//! - Pre-computed lowercase strings avoid per-query allocation.
//! - `find_similar` uses `par_iter` for O(n/cores) throughput.
//! - Stats are pre-computed at index build time (not per-request).

use crate::crypto;
use crate::math;
use crate::models::{HexVector, HexVectorDatabase, LegacyHexVectorDatabase, OriginalHexVectorDatabase};
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::path::Path;
use unicode_normalization::UnicodeNormalization;
use zeroize::Zeroize;

/// Normalize text for accent-insensitive search.
/// Lowercase + NFD decompose + strip combining marks (diacritics).
/// e.g. "São Paulo" → "sao paulo", "Zürich" → "zurich", "Malmö" → "malmo"
fn normalize_for_search(s: &str) -> String {
    s.to_lowercase()
        .nfd()
        .filter(|c| !unicode_normalization::char::is_combining_mark(*c))
        .collect()
}

/// Map ISO 3166-1 alpha-2 country code to common English name(s).
/// Returns the code itself as fallback for unmapped codes.
fn country_name_for_search(code: &str) -> String {
    let names = match code.to_uppercase().as_str() {
        "HK" => "hong kong",
        "MO" => "macau macao",
        "TW" => "taiwan",
        "KR" => "south korea",
        "KP" => "north korea",
        "AE" => "united arab emirates uae dubai",
        "SA" => "saudi arabia",
        "GB" => "united kingdom uk england scotland wales",
        "US" => "united states usa america",
        "CZ" => "czech republic czechia",
        "CG" => "congo republic brazzaville",
        "CD" => "congo democratic kinshasa drc",
        "CI" => "ivory coast cote d ivoire",
        "GE" => "georgia",
        "CY" => "cyprus",
        "OM" => "oman",
        "KM" => "comoros",
        "EH" => "western sahara",
        "FM" => "micronesia",
        "RE" => "reunion",
        "NZ" => "new zealand",
        "ZA" => "south africa",
        "SG" => "singapore",
        "MY" => "malaysia",
        "TH" => "thailand",
        "VN" => "vietnam viet nam",
        "PH" => "philippines",
        "ID" => "indonesia",
        "JP" => "japan",
        "CN" => "china",
        "IN" => "india",
        "BR" => "brazil",
        "AR" => "argentina",
        "MX" => "mexico",
        "CO" => "colombia",
        "DE" => "germany deutschland",
        "FR" => "france",
        "IT" => "italy",
        "ES" => "spain",
        "PT" => "portugal",
        "NL" => "netherlands holland",
        "BE" => "belgium",
        "CH" => "switzerland",
        "AT" => "austria",
        "SE" => "sweden",
        "NO" => "norway",
        "DK" => "denmark",
        "FI" => "finland",
        "PL" => "poland",
        "GR" => "greece",
        "TR" => "turkey turkiye",
        "RU" => "russia",
        "UA" => "ukraine",
        "EG" => "egypt",
        "NG" => "nigeria",
        "KE" => "kenya",
        "AU" => "australia",
        "CA" => "canada",
        "IL" => "israel",
        _ => "",
    };
    if names.is_empty() {
        normalize_for_search(code)
    } else {
        names.to_string()
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Pre-computed search entry
// ─────────────────────────────────────────────────────────────────────────────

/// Pre-computed lowercase fields for O(1) text search per hexagon.
struct SearchEntry {
    admin_lower: String,
    city_lower: String,
    country_lower: String,
    country_name_lower: String,
}

// ─────────────────────────────────────────────────────────────────────────────
// Pre-computed statistics (computed once at startup)
// ─────────────────────────────────────────────────────────────────────────────

/// Database statistics pre-computed at index build time.
/// Avoids iterating all hexagons on every `/stats` request.
pub struct DbStats {
    pub total_hexagons: u32,
    pub total_countries: usize,
    pub total_cities: usize,
    pub schema_version: u8,
    pub spec_version: String,
    pub built_at: String,
    pub sigma_squared: f64,
}

// ─────────────────────────────────────────────────────────────────────────────
// Search result
// ─────────────────────────────────────────────────────────────────────────────

pub struct HexMatchResult {
    pub hex_idx: usize,
    pub similarity: f64,
    pub distance: f64,
}

// ─────────────────────────────────────────────────────────────────────────────
// Hex index
// ─────────────────────────────────────────────────────────────────────────────

pub struct HexIndex {
    pub db: HexVectorDatabase,
    h3_map: HashMap<u64, usize>,
    search_entries: Vec<SearchEntry>,
    /// Pre-computed stats — served directly on /stats without iteration.
    pub stats: DbStats,
    /// Sorted list of unique country codes (e.g. ["DE","JP","KR","US"]).
    country_list: Vec<String>,
    /// Country code → sorted list of city names in that country.
    country_cities: HashMap<String, Vec<String>>,
}

impl HexIndex {
    /// Load and decrypt an `.edbh` file, validate vectors, and build
    /// the in-memory search index with pre-computed lookup tables.
    ///
    /// Convenience wrapper around [`Self::from_edbh_with_progress`] with a
    /// no-op progress callback. Kept for tests and CLI tooling; production
    /// code uses `from_edbh_with_progress` for progress reporting.
    #[allow(dead_code)]
    pub fn from_edbh<P: AsRef<Path>>(path: P) -> anyhow::Result<Self> {
        Self::from_edbh_with_progress(path, |_| {})
    }

    /// Same as `from_edbh` but calls `on_progress(percent: u8)` at key stages (0-95).
    pub fn from_edbh_with_progress<P, F>(path: P, on_progress: F) -> anyhow::Result<Self>
    where
        P: AsRef<Path>,
        F: Fn(u8),
    {
        on_progress(5);
        let mut plaintext = crypto::decrypt_edbh_file(&path)?;
        on_progress(30);

        // Try formats in order: current (poi_counts) → legacy (country_code, no poi_counts) → original (no country_code, no poi_counts).
        let mut db: HexVectorDatabase = match bincode::deserialize::<HexVectorDatabase>(&plaintext) {
            Ok(db) => {
                tracing::info!("Loaded current-format .edbh (with poi_counts)");
                db
            }
            Err(_) => match bincode::deserialize::<LegacyHexVectorDatabase>(&plaintext) {
                Ok(legacy) => {
                    tracing::info!(
                        "Loaded legacy .edbh (country_code, no poi_counts) — {} hexagons",
                        legacy.hex_count
                    );
                    legacy.into_current()
                }
                Err(_) => {
                    tracing::info!("Trying original .edbh format (no country_code, no poi_counts)...");
                    let original: OriginalHexVectorDatabase = bincode::deserialize(&plaintext)
                        .map_err(|e| anyhow::anyhow!("Deserialization failed (all formats): {}", e))?;
                    tracing::info!(
                        "Loaded original .edbh — {} hexagons",
                        original.hex_count
                    );
                    original.into_current()
                }
            },
        };

        plaintext.zeroize();
        on_progress(50);

        // ── Fill missing admin_name ──────────────────────────────────────
        // Hexagons with admin_level == 0 fell back to the city name during
        // collection (no admin boundary polygon covered their centroid).
        //
        // Strategy (cascading):
        //   Pass 1: nearest hex with admin_level > 0 in the SAME CITY
        //   Pass 2: nearest hex with admin_level > 0 in the SAME COUNTRY
        //   Pass 3: still unresolved → leave as city name
        //
        // Optimization: patches are cached in <hexdb>.adm so subsequent starts
        // skip the expensive O(n×k) nearest-neighbor search entirely.
        {
            use rayon::prelude::*;

            // Admin patch cache path: e.g. "hexagons.edbh.adm"
            let patch_cache_path = {
                let src = path.as_ref();
                let fname = src.file_name().unwrap_or_default().to_string_lossy().to_string();
                src.with_file_name(format!("{}.adm", fname))
            };

            // Check if cache is valid (exists and newer than the source .edbh file)
            let cache_valid = patch_cache_path.exists() && {
                let src_mt = std::fs::metadata(path.as_ref()).and_then(|m| m.modified()).ok();
                let cache_mt = std::fs::metadata(&patch_cache_path).and_then(|m| m.modified()).ok();
                matches!((src_mt, cache_mt), (Some(s), Some(c)) if c >= s)
            };

            if cache_valid {
                // ── Fast path: apply cached patches ──────────────────────
                match std::fs::read(&patch_cache_path)
                    .ok()
                    .and_then(|d| bincode::deserialize::<Vec<(u32, String, u8)>>(&d).ok())
                {
                    Some(patches) => {
                        tracing::info!("⚡ admin_name cache hit — applying {} cached patches (skipping interpolation)", patches.len());
                        for (idx, name, level) in patches {
                            if let Some(hex) = db.hexagons.get_mut(idx as usize) {
                                hex.admin_name = name;
                                hex.admin_level = level;
                            }
                        }
                    }
                    None => {
                        tracing::warn!("Admin cache unreadable, will recompute");
                        // Fall through to recompute — delete corrupt cache
                        let _ = std::fs::remove_file(&patch_cache_path);
                    }
                }
            } else {
                // ── Slow path (first start): compute + save cache ─────────
                let total_zero_before: usize = db.hexagons.iter().filter(|h| h.admin_level == 0).count();
                tracing::info!(
                    "🏘️ admin_name: {}/{} hexagons need interpolation (computing, will cache after)…",
                    total_zero_before, db.hexagons.len()
                );

                let n = db.hexagons.len();
                let hexagons = &db.hexagons;

                // ── Pass 1: Same-city interpolation (parallel) ──
                let mut good_by_city: HashMap<String, Vec<usize>> = HashMap::new();
                for (i, hex) in hexagons.iter().enumerate() {
                    if hex.admin_level > 0 {
                        good_by_city.entry(hex.parent_city_name.clone()).or_default().push(i);
                    }
                }

                let patches1: Vec<(usize, String, u8)> = (0..n)
                    .into_par_iter()
                    .filter_map(|i| {
                        let hex = &hexagons[i];
                        if hex.admin_level != 0 { return None; }
                        let good_idxs = good_by_city.get(&hex.parent_city_name)?;
                        let (best_idx, _) = good_idxs.iter().fold((usize::MAX, f64::MAX), |(bi, bd), &gi| {
                            let g = &hexagons[gi];
                            let dlat = (hex.lat - g.lat) as f64;
                            let dlon = (hex.lon - g.lon) as f64;
                            let d2 = dlat * dlat + dlon * dlon;
                            if d2 < bd { (gi, d2) } else { (bi, bd) }
                        });
                        if best_idx == usize::MAX { return None; }
                        let best = &hexagons[best_idx];
                        Some((i, best.admin_name.clone(), best.admin_level))
                    })
                    .collect();

                let patched_city = patches1.len();
                for (i, name, level) in &patches1 {
                    db.hexagons[*i].admin_name = name.clone();
                    db.hexagons[*i].admin_level = *level;
                }

                // ── Pass 2: Same-country interpolation (parallel) ──
                let hexagons = &db.hexagons;
                let mut good_by_country: HashMap<String, Vec<usize>> = HashMap::new();
                for (i, hex) in hexagons.iter().enumerate() {
                    if hex.admin_level > 0 && !hex.country_code.is_empty() {
                        good_by_country.entry(hex.country_code.clone()).or_default().push(i);
                    }
                }

                let patches2: Vec<(usize, String, u8)> = (0..n)
                    .into_par_iter()
                    .filter_map(|i| {
                        let hex = &hexagons[i];
                        if hex.admin_level != 0 || hex.country_code.is_empty() { return None; }
                        let good_idxs = good_by_country.get(&hex.country_code)?;
                        let (best_idx, _) = good_idxs.iter().fold((usize::MAX, f64::MAX), |(bi, bd), &gi| {
                            let g = &hexagons[gi];
                            let dlat = (hex.lat - g.lat) as f64;
                            let dlon = (hex.lon - g.lon) as f64;
                            let d2 = dlat * dlat + dlon * dlon;
                            if d2 < bd { (gi, d2) } else { (bi, bd) }
                        });
                        if best_idx == usize::MAX { return None; }
                        let best = &hexagons[best_idx];
                        Some((i, best.admin_name.clone(), best.admin_level))
                    })
                    .collect();

                let patched_country = patches2.len();
                for (i, name, level) in &patches2 {
                    db.hexagons[*i].admin_name = name.clone();
                    db.hexagons[*i].admin_level = *level;
                }

                let still_zero: usize = db.hexagons.iter().filter(|h| h.admin_level == 0).count();
                tracing::info!(
                    "🏘️ admin_name interpolation: {} via same-city, {} via same-country, {} still unresolved (of {} total)",
                    patched_city, patched_country, still_zero, n
                );

                // ── Save patch cache for fast subsequent starts ──
                let mut all_patches: Vec<(u32, String, u8)> = Vec::with_capacity(patched_city + patched_country);
                for (i, name, level) in patches1 {
                    all_patches.push((i as u32, name, level));
                }
                for (i, name, level) in patches2 {
                    all_patches.push((i as u32, name, level));
                }
                match bincode::serialize(&all_patches) {
                    Ok(data) => {
                        if let Err(e) = std::fs::write(&patch_cache_path, &data) {
                            tracing::warn!("Could not save admin cache: {}", e);
                        } else {
                            tracing::info!("💾 Saved admin cache ({} patches, {} KB) → {:?}",
                                all_patches.len(), data.len() / 1024, patch_cache_path);
                        }
                    }
                    Err(e) => tracing::warn!("Could not serialize admin cache: {}", e),
                }
            }
        }

        on_progress(70);

        // Validate all vectors are in [0,1] and finite.
        // Corrupted entries are skipped with a warning instead of crashing the app.
        let before = db.hexagons.len();
        db.hexagons.retain(|hex| {
            for (dim, &v) in hex.vector.iter().enumerate() {
                if !(0.0..=1.0).contains(&v) || !v.is_finite() {
                    tracing::warn!(
                        "Skipping corrupted hex vector (h3={}): dim {} = {} — re-run data build to fix",
                        hex.h3_index, dim, v
                    );
                    return false;
                }
            }
            true
        });
        let skipped = before - db.hexagons.len();
        if skipped > 0 {
            tracing::warn!(
                "Skipped {} corrupted hexagons during load ({}% of total)",
                skipped,
                skipped * 100 / before.max(1)
            );
        }
        // Re-sync hex_count after removing bad entries
        db.hex_count = db.hexagons.len() as u32;

        // Build H3 → index lookup and pre-compute lowercase strings.
        let mut h3_map = HashMap::with_capacity(db.hexagons.len());
        let mut search_entries = Vec::with_capacity(db.hexagons.len());
        let mut countries = HashSet::new();
        let mut cities = HashSet::new();
        let mut country_cities_set: HashMap<String, BTreeSet<String>> = HashMap::new();

        for (i, hex) in db.hexagons.iter().enumerate() {
            h3_map.insert(hex.h3_index, i);
            search_entries.push(SearchEntry {
                admin_lower: normalize_for_search(&hex.admin_name),
                city_lower: normalize_for_search(&hex.parent_city_name),
                country_lower: normalize_for_search(&hex.country_code),
                country_name_lower: country_name_for_search(&hex.country_code),
            });
            countries.insert(hex.country_code.as_str());
            cities.insert(hex.parent_city_name.as_str());
            if !hex.country_code.is_empty() {
                country_cities_set
                    .entry(hex.country_code.clone())
                    .or_default()
                    .insert(hex.parent_city_name.clone());
            }
        }

        on_progress(85);

        // Build sorted country list and per-country city lists.
        let mut country_list: Vec<String> = countries.iter().filter(|c| !c.is_empty()).map(|c| c.to_string()).collect();
        country_list.sort();
        let country_cities: HashMap<String, Vec<String>> = country_cities_set
            .into_iter()
            .map(|(k, v)| (k, v.into_iter().filter(|c| !c.is_empty()).collect()))
            .collect();

        let stats = DbStats {
            total_hexagons: db.hex_count,
            total_countries: countries.len(),
            total_cities: cities.len(),
            schema_version: db.schema_version,
            spec_version: db.spec_version.clone(),
            built_at: db.built_at.clone(),
            sigma_squared: db.sigma_squared,
        };

        Ok(Self {
            db,
            h3_map,
            search_entries,
            stats,
            country_list,
            country_cities,
        })
    }

    /// Lookup a single hexagon by H3 index.
    pub fn get_hex(&self, h3_index: u64) -> Option<&HexVector> {
        self.h3_map.get(&h3_index).map(|&idx| &self.db.hexagons[idx])
    }

    /// Get hexagon by internal array index.
    pub fn hex_at(&self, idx: usize) -> &HexVector {
        &self.db.hexagons[idx]
    }

    /// List all unique country codes (sorted).
    pub fn list_countries(&self) -> &[String] {
        &self.country_list
    }

    /// List cities for a given country code (sorted). Returns empty slice if not found.
    pub fn list_cities(&self, country_code: &str) -> &[String] {
        self.country_cities
            .get(&country_code.to_uppercase())
            .map(|v| v.as_slice())
            .unwrap_or(&[])
    }

    /// Find the `k` most similar hexagons to the given query vector.
    ///
    /// Uses Rayon `par_iter` for parallel throughput.
    ///
    /// Exposed as public API surface for future "similar neighborhoods" feature;
    /// not yet wired in the main request router.
    #[allow(dead_code)]
    pub fn find_similar(
        &self,
        query_vector: &[f32; 13],
        k: usize,
        exclude_h3: Option<u64>,
        country_filter: Option<&str>,
        city_filter: Option<&str>,
    ) -> Vec<HexMatchResult> {
        use rayon::prelude::*;

        let kp = self.db.sigma_squared;
        let country_lower = country_filter.map(|s| normalize_for_search(s));
        let city_lower = city_filter.map(|s| normalize_for_search(s));

        let mut results: Vec<HexMatchResult> = self
            .db
            .hexagons
            .par_iter()
            .enumerate()
            .filter(|(_, hex)| exclude_h3.map_or(true, |h| hex.h3_index != h))
            .filter(|(idx, _)| {
                let entry = &self.search_entries[*idx];
                if let Some(ref cc) = country_lower {
                    if entry.country_lower != *cc {
                        return false;
                    }
                }
                if let Some(ref city) = city_lower {
                    if !entry.city_lower.contains(city.as_str()) {
                        return false;
                    }
                }
                true
            })
            .map(|(idx, hex)| {
                let dist_sq = math::l2_squared(query_vector, &hex.vector);
                let similarity = (-dist_sq as f64 / kp).exp();
                HexMatchResult {
                    hex_idx: idx,
                    similarity,
                    distance: (dist_sq as f64).sqrt(),
                }
            })
            .collect();

        results.sort_by(|a, b| {
            b.similarity
                .partial_cmp(&a.similarity)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        results.truncate(k);
        results
    }

    /// Find the `k` most similar hexagons using vectors merged with user overlays.
    ///
    /// Overlay map key: h3_index, value: [vitality, culture, relief, rhythm, lifestyle, commercial, total].
    pub fn find_similar_with_overlay(
        &self,
        query_vector: &[f32; 13],
        k: usize,
        exclude_h3: Option<u64>,
        country_filter: Option<&str>,
        city_filter: Option<&str>,
        overlay_map: Option<&HashMap<u64, [u32; 7]>>,
    ) -> Vec<HexMatchResult> {
        use rayon::prelude::*;

        let sigma_sq = self.db.sigma_squared;
        let country_lower = country_filter.map(|s| normalize_for_search(s));
        let city_lower = city_filter.map(|s| normalize_for_search(s));

        let mut results: Vec<HexMatchResult> = self
            .db
            .hexagons
            .par_iter()
            .enumerate()
            .filter(|(_, hex)| exclude_h3.map_or(true, |h| hex.h3_index != h))
            .filter(|(idx, _)| {
                let entry = &self.search_entries[*idx];
                if let Some(ref cc) = country_lower {
                    if entry.country_lower != *cc {
                        return false;
                    }
                }
                if let Some(ref city) = city_lower {
                    if !entry.city_lower.contains(city.as_str()) {
                        return false;
                    }
                }
                true
            })
            .map(|(idx, hex)| {
                let mut merged_vector = hex.vector;
                if let Some(overlays) = overlay_map {
                    if let Some(user_counts) = overlays.get(&hex.h3_index) {
                        math::rebuild_vibe_dims(&mut merged_vector, &hex.poi_counts, Some(user_counts));
                    }
                }

                let dist_sq = math::l2_squared(query_vector, &merged_vector);
                let similarity = (-dist_sq as f64 / sigma_sq).exp();
                HexMatchResult {
                    hex_idx: idx,
                    similarity,
                    distance: (dist_sq as f64).sqrt(),
                }
            })
            .collect();

        results.sort_by(|a, b| {
            b.similarity
                .partial_cmp(&a.similarity)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        results.truncate(k);
        results
    }

    /// Return hexagons within a geographic bounding box.
    ///
    /// If more hexagons match than `limit`, samples evenly spaced entries
    /// sorted by latitude to maintain geographic coverage.
    pub fn viewport(
        &self,
        north: f32,
        south: f32,
        east: f32,
        west: f32,
        limit: usize,
    ) -> Vec<&HexVector> {
        let crosses_antimeridian = east < west;

        let mut in_bbox: Vec<&HexVector> = self
            .db
            .hexagons
            .iter()
            .filter(|h| {
                h.lat >= south
                    && h.lat <= north
                    && if crosses_antimeridian {
                        h.lon >= west || h.lon <= east
                    } else {
                        h.lon >= west && h.lon <= east
                    }
            })
            .collect();

        if in_bbox.is_empty() || in_bbox.len() <= limit {
            return in_bbox;
        }

        // Sort by lat then lon for geographic distribution
        in_bbox.sort_by(|a, b| {
            a.lat
                .partial_cmp(&b.lat)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then(
                    a.lon
                        .partial_cmp(&b.lon)
                        .unwrap_or(std::cmp::Ordering::Equal),
                )
        });

        let step = in_bbox.len() as f64 / limit as f64;
        (0..limit)
            .map(|i| in_bbox[((i as f64 * step) as usize).min(in_bbox.len() - 1)])
            .collect()
    }

    /// Return a geographically diverse seed sample.
    ///
    /// Groups hexagons by country, picks one representative per unique city
    /// in each country, then round-robins across countries so that all 166+
    /// countries appear before any country gets a second city.
    pub fn seed_diverse(&self, limit: usize) -> Vec<&HexVector> {
        // Collect one representative hex per (country, city) pair
        let mut country_cities: BTreeMap<&str, Vec<usize>> = BTreeMap::new();
        let mut seen: HashSet<(&str, &str)> = HashSet::new();

        for (i, hex) in self.db.hexagons.iter().enumerate() {
            let country = hex.country_code.as_str();
            let city = if hex.parent_city_name.is_empty() {
                hex.admin_name.as_str()
            } else {
                hex.parent_city_name.as_str()
            };
            if seen.insert((country, city)) {
                country_cities.entry(country).or_default().push(i);
            }
        }

        // Round-robin across countries for maximum geographic spread
        let groups: Vec<Vec<usize>> = country_cities.into_values().collect();
        let mut result: Vec<&HexVector> = Vec::with_capacity(limit);
        let mut round = 0;

        loop {
            let mut added = false;
            for group in &groups {
                if round < group.len() {
                    result.push(&self.db.hexagons[group[round]]);
                    added = true;
                    if result.len() >= limit {
                        return result;
                    }
                }
            }
            if !added {
                break;
            }
            round += 1;
        }

        result
    }

    /// Find the nearest hexagon to a given lat/lon point.
    ///
    /// Uses simple Euclidean distance on lat/lon (sufficient for
    /// nearby cells since H3 res 7 cells are ~1 km apart).
    /// Returns None if the database is empty.
    ///
    /// Utility for debugging and CLI tools; not called in the hot search path.
    #[allow(dead_code)]
    pub fn nearest(&self, lat: f32, lon: f32) -> Option<&HexVector> {
        self.db
            .hexagons
            .iter()
            .min_by(|a, b| {
                let da = (a.lat - lat).powi(2) + (a.lon - lon).powi(2);
                let db_dist = (b.lat - lat).powi(2) + (b.lon - lon).powi(2);
                da.partial_cmp(&db_dist).unwrap_or(std::cmp::Ordering::Equal)
            })
    }

    /// Find the k nearest hexagons to a given lat/lon point.
    pub fn nearest_k(&self, lat: f32, lon: f32, k: usize) -> Vec<&HexVector> {
        let mut indexed: Vec<(f32, &HexVector)> = self
            .db
            .hexagons
            .iter()
            .map(|h| {
                let d = (h.lat - lat).powi(2) + (h.lon - lon).powi(2);
                (d, h)
            })
            .collect();
        indexed.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
        indexed.truncate(k);
        indexed.into_iter().map(|(_, h)| h).collect()
    }

    /// Find top-N hexagons by weighted 6-axis Urban Vibe suitability.
    ///
    /// Weights correspond to the 6 axes in vector order:
    /// `[active/vitality, classic/culture, quiet/relief, trendy/rhythm, nature/lifestyle, urban/commercial]`
    ///
    /// Suitability = Σ(w[i] * radar[i]) / Σw, where radar values are computed
    /// from raw `poi_counts` (with optional user overlay merging).
    ///
    /// Runs Rayon parallel iteration — typical latency ~50–200 ms for 4M hexagons.
    pub fn discover_by_weights(
        &self,
        weights: &[f32; 6],
        limit: usize,
        country_filter: Option<&str>,
        city_filter: Option<&str>,
        overlay_map: Option<&HashMap<u64, [u32; 7]>>,
    ) -> Vec<(f64, usize)> {
        use rayon::prelude::*;

        let total_w: f32 = weights.iter().map(|w| w.abs()).sum();
        if total_w < 1e-6 {
            return Vec::new();
        }

        let country_lower = country_filter.map(|s| normalize_for_search(s));
        let city_lower = city_filter.map(|s| normalize_for_search(s));

        let mut scored: Vec<(f64, usize)> = self
            .db
            .hexagons
            .par_iter()
            .enumerate()
            .filter(|(idx, _)| {
                let entry = &self.search_entries[*idx];
                if let Some(ref cc) = country_lower {
                    if entry.country_lower != *cc {
                        return false;
                    }
                }
                if let Some(ref city) = city_lower {
                    if !entry.city_lower.contains(city.as_str()) {
                        return false;
                    }
                }
                true
            })
            .map(|(idx, hex)| {
                let user_counts = overlay_map.and_then(|m| m.get(&hex.h3_index));

                // 6-axis radar computed inline (avoids JSON allocation in hot path)
                let radar: [f32; 6] = if hex.poi_counts[6] == 0 && user_counts.is_none() {
                    // Legacy: use pre-computed vector dims 0-5
                    hex.vector[..6].try_into().unwrap_or([0f32; 6])
                } else {
                    let mut merged = hex.poi_counts;
                    if let Some(uc) = user_counts {
                        for i in 0..7 {
                            merged[i] += uc[i];
                        }
                    }
                    let total = merged[6].max(1) as f32;
                    let mut r = [0f32; 6];
                    for i in 0..6 {
                        r[i] = (merged[i] as f32 / total).clamp(0.0, 1.0);
                    }
                    r
                };

                let score: f32 = weights
                    .iter()
                    .zip(radar.iter())
                    .map(|(w, r)| w.abs() * r)
                    .sum();
                let suitability = ((score / total_w) as f64).clamp(0.0, 1.0);
                (suitability, idx)
            })
            .collect();

        scored.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
        scored.truncate(limit);
        scored
    }

    /// Text search across admin_name, city, and country fields.
    ///
    /// Ranking: exact match > prefix match > contains match,
    /// then by admin_level (higher-level = more important).
    ///
    /// When query is empty and no filters are set, delegates to
    /// `seed_diverse()` for a geographically representative sample.
    pub fn search(
        &self,
        query: &str,
        limit: usize,
        country_filter: Option<&str>,
        city_filter: Option<&str>,
    ) -> Vec<&HexVector> {
        let q = normalize_for_search(query);
        let country_lower = country_filter.map(|s| normalize_for_search(s));
        let city_lower = city_filter.map(|s| normalize_for_search(s));

        // Empty query without filters → diverse seed sample
        if q.is_empty() && country_lower.is_none() && city_lower.is_none() {
            return self.seed_diverse(limit);
        }

        let mut matches: Vec<(usize, &HexVector)> = self
            .db
            .hexagons
            .iter()
            .enumerate()
            .filter(|(idx, _)| {
                let entry = &self.search_entries[*idx];
                if let Some(ref cc) = country_lower {
                    if entry.country_lower != *cc {
                        return false;
                    }
                }
                if let Some(ref city) = city_lower {
                    if !entry.city_lower.contains(city.as_str()) {
                        return false;
                    }
                }
                if q.is_empty() {
                    return true;
                }
                entry.admin_lower.contains(&q)
                    || entry.city_lower.contains(&q)
                    || entry.country_lower.contains(&q)
                    || entry.country_name_lower.contains(&q)
            })
            .collect();

        matches.sort_by(|(idx_a, _a), (idx_b, _b)| {
            let ea = &self.search_entries[*idx_a];
            let eb = &self.search_entries[*idx_b];

            let a_exact = ea.admin_lower == q || ea.city_lower == q;
            let b_exact = eb.admin_lower == q || eb.city_lower == q;
            let a_prefix = ea.admin_lower.starts_with(&q) || ea.city_lower.starts_with(&q);
            let b_prefix = eb.admin_lower.starts_with(&q) || eb.city_lower.starts_with(&q);

            b_exact
                .cmp(&a_exact)
                .then(b_prefix.cmp(&a_prefix))
                .then(
                    self.db.hexagons[*idx_a]
                        .admin_level
                        .cmp(&self.db.hexagons[*idx_b].admin_level),
                )
        });
        matches.truncate(limit.max(1));
        matches.into_iter().map(|(_, hex)| hex).collect()
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{DataSource, HexVector, HexVectorDatabase};

    /// Build a minimal `HexIndex` from an in-memory `HexVectorDatabase`,
    /// bypassing file I/O and decryption. For tests only.
    fn make_index(hexagons: Vec<HexVector>) -> HexIndex {
        let hex_count = hexagons.len() as u32;
        let db = HexVectorDatabase {
            schema_version: 1,
            spec_version: "1.0".to_string(),
            built_at: "2026-01-01".to_string(),
            hex_count,
            sigma_squared: 0.25,
            faiss_index_type: "flat".to_string(),
            data_sources: vec![DataSource {
                name: "test".to_string(),
                license: "test".to_string(),
                url: "test".to_string(),
            }],
            hexagons,
        };

        let mut h3_map = HashMap::with_capacity(db.hexagons.len());
        let mut search_entries = Vec::with_capacity(db.hexagons.len());
        let mut countries = HashSet::new();
        let mut cities = HashSet::new();
        let mut country_cities_set: HashMap<String, BTreeSet<String>> = HashMap::new();

        for (i, hex) in db.hexagons.iter().enumerate() {
            h3_map.insert(hex.h3_index, i);
            search_entries.push(SearchEntry {
                admin_lower: normalize_for_search(&hex.admin_name),
                city_lower: normalize_for_search(&hex.parent_city_name),
                country_lower: normalize_for_search(&hex.country_code),
                country_name_lower: country_name_for_search(&hex.country_code),
            });
            countries.insert(hex.country_code.as_str());
            cities.insert(hex.parent_city_name.as_str());
            if !hex.country_code.is_empty() {
                country_cities_set
                    .entry(hex.country_code.clone())
                    .or_default()
                    .insert(hex.parent_city_name.clone());
            }
        }

        let mut country_list: Vec<String> = countries
            .iter()
            .filter(|c| !c.is_empty())
            .map(|c| c.to_string())
            .collect();
        country_list.sort();
        let country_cities: HashMap<String, Vec<String>> = country_cities_set
            .into_iter()
            .map(|(k, v)| (k, v.into_iter().filter(|c| !c.is_empty()).collect()))
            .collect();

        let stats = DbStats {
            total_hexagons: hex_count,
            total_countries: countries.len(),
            total_cities: cities.len(),
            schema_version: db.schema_version,
            spec_version: db.spec_version.clone(),
            built_at: db.built_at.clone(),
            sigma_squared: db.sigma_squared,
        };

        HexIndex { db, h3_map, search_entries, stats, country_list, country_cities }
    }

    fn make_hex(
        h3: u64,
        lat: f32,
        lon: f32,
        admin: &str,
        city: &str,
        country: &str,
        vector: [f32; 13],
    ) -> HexVector {
        HexVector {
            h3_index: h3,
            lat,
            lon,
            admin_name: admin.to_string(),
            admin_level: 5,
            country_code: country.to_string(),
            parent_city_id: 1,
            parent_city_name: city.to_string(),
            vector,
            poi_counts: [10, 5, 8, 3, 4, 6, 36],
        }
    }

    // ── Text search ───────────────────────────────────────────────────────────

    #[test]
    fn search_exact_match_ranked_first() {
        let hexes = vec![
            make_hex(1, 37.5, 127.0, "Gangnam", "Seoul", "KR", [0.5f32; 13]),
            make_hex(2, 37.6, 127.1, "Gangnam-gu", "Seoul", "KR", [0.4f32; 13]),
            make_hex(3, 35.1, 129.0, "Haeundae", "Busan", "KR", [0.3f32; 13]),
        ];
        let idx = make_index(hexes);
        let results = idx.search("gangnam", 10, None, None);

        assert!(!results.is_empty());
        // Exact match "Gangnam" should appear before partial "Gangnam-gu"
        assert_eq!(results[0].admin_name, "Gangnam");
    }

    #[test]
    fn search_country_filter() {
        let hexes = vec![
            make_hex(1, 35.7, 139.7, "Shibuya", "Tokyo", "JP", [0.5f32; 13]),
            make_hex(2, 35.6, 139.6, "Shinjuku", "Tokyo", "JP", [0.4f32; 13]),
            make_hex(3, 37.6, 127.1, "Mapo", "Seoul", "KR", [0.3f32; 13]),
        ];
        let idx = make_index(hexes);
        let results = idx.search("", 10, Some("JP"), None);

        assert_eq!(results.len(), 2);
        assert!(results.iter().all(|h| h.country_code == "JP"));
    }

    #[test]
    fn search_city_filter() {
        let hexes = vec![
            make_hex(1, 37.5, 127.0, "Gangnam", "Seoul", "KR", [0.5f32; 13]),
            make_hex(2, 37.6, 127.1, "Mapo", "Seoul", "KR", [0.4f32; 13]),
            make_hex(3, 35.1, 129.0, "Haeundae", "Busan", "KR", [0.3f32; 13]),
        ];
        let idx = make_index(hexes);
        let results = idx.search("", 10, None, Some("Seoul"));

        assert_eq!(results.len(), 2);
        assert!(results.iter().all(|h| h.parent_city_name == "Seoul"));
    }

    #[test]
    fn search_no_results_for_unknown_query() {
        let hexes = vec![make_hex(1, 37.5, 127.0, "Gangnam", "Seoul", "KR", [0.5f32; 13])];
        let idx = make_index(hexes);
        let results = idx.search("xyzzy_no_such_place", 10, None, None);
        assert!(results.is_empty());
    }

    #[test]
    fn search_limit_respected() {
        let hexes: Vec<HexVector> = (1u64..=20)
            .map(|i| make_hex(i, i as f32, i as f32, "Place", "City", "XX", [0.5f32; 13]))
            .collect();
        let idx = make_index(hexes);
        let results = idx.search("place", 5, None, None);
        assert!(results.len() <= 5);
    }

    // ── Viewport ──────────────────────────────────────────────────────────────

    #[test]
    fn viewport_returns_hexes_in_bbox() {
        let hexes = vec![
            make_hex(1, 37.5, 127.0, "A", "Seoul", "KR", [0.5f32; 13]), // inside
            make_hex(2, 37.6, 127.1, "B", "Seoul", "KR", [0.4f32; 13]), // inside
            make_hex(3, 10.0, 10.0, "C", "Remote", "XX", [0.3f32; 13]), // outside
        ];
        let idx = make_index(hexes);
        let results = idx.viewport(38.0, 37.0, 128.0, 126.0, 100);

        assert_eq!(results.len(), 2);
        assert!(results.iter().all(|h| h.lat >= 37.0 && h.lat <= 38.0));
    }

    #[test]
    fn viewport_limit_applied() {
        let hexes: Vec<HexVector> = (0..10)
            .map(|i| {
                make_hex(
                    i as u64 + 1,
                    37.5 + i as f32 * 0.01,
                    127.0,
                    "X",
                    "C",
                    "KR",
                    [0.5f32; 13],
                )
            })
            .collect();
        let idx = make_index(hexes);
        let results = idx.viewport(40.0, 36.0, 130.0, 125.0, 3);
        assert_eq!(results.len(), 3);
    }

    // ── Nearest ───────────────────────────────────────────────────────────────

    #[test]
    fn nearest_k_returns_closest() {
        let hexes = vec![
            make_hex(1, 37.5, 127.0, "Near", "Seoul", "KR", [0.5f32; 13]),
            make_hex(2, 37.6, 127.1, "Mid", "Seoul", "KR", [0.4f32; 13]),
            make_hex(3, 50.0, 14.4, "Prague", "Prague", "CZ", [0.3f32; 13]),
        ];
        let idx = make_index(hexes);
        let results = idx.nearest_k(37.5, 127.0, 1);

        assert_eq!(results.len(), 1);
        assert_eq!(results[0].admin_name, "Near");
    }

    // ── Stats ─────────────────────────────────────────────────────────────────

    #[test]
    fn stats_populated_correctly() {
        let hexes = vec![
            make_hex(1, 37.5, 127.0, "Gangnam", "Seoul", "KR", [0.5f32; 13]),
            make_hex(2, 35.7, 139.7, "Shibuya", "Tokyo", "JP", [0.4f32; 13]),
            make_hex(3, 48.8, 2.3, "Marais", "Paris", "FR", [0.3f32; 13]),
        ];
        let idx = make_index(hexes);

        assert_eq!(idx.stats.total_hexagons, 3);
        assert_eq!(idx.stats.total_countries, 3);
        assert_eq!(idx.stats.total_cities, 3);
    }

    // ── Country/city lists ────────────────────────────────────────────────────

    #[test]
    fn list_countries_sorted() {
        let hexes = vec![
            make_hex(1, 37.5, 127.0, "X", "Seoul", "KR", [0.5f32; 13]),
            make_hex(2, 35.7, 139.7, "X", "Tokyo", "JP", [0.4f32; 13]),
            make_hex(3, 48.8, 2.3, "X", "Paris", "FR", [0.3f32; 13]),
        ];
        let idx = make_index(hexes);
        let countries = idx.list_countries();
        assert_eq!(countries, &["FR", "JP", "KR"]);
    }

    #[test]
    fn list_cities_for_country() {
        let hexes = vec![
            make_hex(1, 37.5, 127.0, "Gangnam", "Seoul", "KR", [0.5f32; 13]),
            make_hex(2, 37.6, 127.1, "Mapo", "Seoul", "KR", [0.4f32; 13]),
            make_hex(3, 35.1, 129.0, "Haeundae", "Busan", "KR", [0.3f32; 13]),
        ];
        let idx = make_index(hexes);
        let cities = idx.list_cities("KR");

        assert_eq!(cities.len(), 2);
        assert!(cities.contains(&"Seoul".to_string()));
        assert!(cities.contains(&"Busan".to_string()));
    }

    // ── get_hex ───────────────────────────────────────────────────────────────

    #[test]
    fn get_hex_by_h3_index() {
        let hexes = vec![make_hex(
            0xABCD_1234u64,
            37.5,
            127.0,
            "Gangnam",
            "Seoul",
            "KR",
            [0.5f32; 13],
        )];
        let idx = make_index(hexes);

        let found = idx.get_hex(0xABCD_1234u64);
        assert!(found.is_some());
        assert_eq!(found.unwrap().admin_name, "Gangnam");

        assert!(idx.get_hex(0xDEAD_BEEFu64).is_none());
    }
}
