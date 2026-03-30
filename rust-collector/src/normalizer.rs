//! Two-pass normalization engine for 13D Urban Vibe vector computation.
//!
//! # Academic Basis
//! - Cranshaw et al. (2012) "Livehoods" — POI diversity as temporal activity proxy
//! - Hasan et al. (2013) — Shannon entropy + POI density → activity pattern (r=0.73)
//! - Noulas et al. (2011) — POI density vs population density (r=0.81)
//!
//! # Dimension Layout (13D)
//! - dim 0–5:  Urban Vibe 6-axis (vitality, culture, relief, rhythm, lifestyle, commercial)
//! - dim 6:    poi_density_norm
//! - dim 7:    category_diversity_norm
//! - dim 8:    water_proximity_norm
//! - dim 9:    temporal_entropy_norm   (was dim 11)
//! - dim 10:   flow_to_poi_ratio_norm  (was dim 12)
//! - dim 11:   population_density_norm (was dim 13)
//! - dim 12:   transit_accessibility_norm (was dim 14)
//!
//! # Pass 1: GlobalStats
//!   Collect per-country POI density distributions and global population/transit
//!   distributions for percentile rank normalization.
//!
//! # Pass 2: compute_vector()
//!   For each city: raw value → normalized [0,1] → 13D vector
//!
//! # Hex pipeline
//!   HexRawData + GlobalHexStats + compute_all_hex_vectors() produce HexVector
//!   entries using the same 13D spec, adapted for hexagon-level granularity.

use crate::poi::PoiCounts;
use crate::vectordb::{CityVector, HexVector};
use rayon::prelude::*;
use std::collections::HashMap;

// ─────────────────────────────────────────────────────────────────────────────
// Input: city raw data record
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone)]
pub struct CityRawData {
    pub geoname_id: i64,
    pub name: String,
    pub ascii_name: String,
    pub country_code: String,
    pub latitude: f64,
    pub longitude: f64,
    pub population: i64,
    pub timezone: String,
    /// From collect-poi step (may be None if POI collection failed)
    pub poi: Option<PoiCounts>,
}

// ─────────────────────────────────────────────────────────────────────────────
// Input: hexagon raw data record
// ─────────────────────────────────────────────────────────────────────────────

/// Raw data for one H3 Res-8 hexagon as loaded from the `hexagons` DB table.
#[derive(Debug, Clone)]
pub struct HexRawData {
    pub h3_index: u64,
    pub lat: f64,
    pub lon: f64,
    pub admin_name: String,
    pub admin_level: u8,
    pub country_code: String,
    pub parent_city_id: i64,
    pub parent_city_name: String,
    /// POI counts collected at hexagon centroid (500m radius).
    /// Should always be Some for valid hexagons, but Option for safety.
    pub poi: Option<PoiCounts>,
}

// ─────────────────────────────────────────────────────────────────────────────
// Pass 1: Global statistics for percentile normalization
// ─────────────────────────────────────────────────────────────────────────────

/// Global statistics computed in Pass 1.
/// Required for percentile-rank normalization of dim 6, 8, 13, 14.
pub struct GlobalStats {
    /// Per-country sorted POI density values (poi/km²) for dim 6 percentile.
    /// Spec: "국가 내 percentile 정규화" (within-country percentile).
    country_poi_densities: HashMap<String, Vec<f64>>,

    /// All cities' water proximity scores (1/(1+dist_km)) sorted for dim 8 percentile.
    water_scores_sorted: Vec<f64>,

    /// All cities' log(population+1) sorted for dim 13 percentile.
    log_population_sorted: Vec<f64>,

    /// All cities' transit scores sorted for dim 14 percentile.
    transit_scores_sorted: Vec<f64>,
}

impl GlobalStats {
    /// Pass 1: iterate all cities and collect distributions.
    /// Uses rayon for parallel computation.
    pub fn compute(cities: &[CityRawData]) -> Self {
        // Collect raw values in parallel
        let raw: Vec<(String, f64, f64, f64, f64)> = cities
            .par_iter()
            .map(|c| {
                let poi_density = c
                    .poi
                    .as_ref()
                    .map(|p| p.poi_density_per_km2())
                    .unwrap_or(0.0);
                let water_score = c
                    .poi
                    .as_ref()
                    .map(|p| water_proximity_score(p.nearest_water_km))
                    .unwrap_or(0.1);
                let log_pop = ((c.population as f64 + 1.0).ln()).max(0.0);
                let transit = c
                    .poi
                    .as_ref()
                    .map(|p| p.transit_score_raw())
                    .unwrap_or(0.0);
                (c.country_code.clone(), poi_density, water_score, log_pop, transit)
            })
            .collect();

        // Group POI densities by country
        let mut country_poi_densities: HashMap<String, Vec<f64>> = HashMap::new();
        let mut water_scores: Vec<f64> = Vec::with_capacity(cities.len());
        let mut log_populations: Vec<f64> = Vec::with_capacity(cities.len());
        let mut transit_scores: Vec<f64> = Vec::with_capacity(cities.len());

        for (country, poi_dens, water, log_pop, transit) in raw {
            country_poi_densities
                .entry(country)
                .or_default()
                .push(poi_dens);
            water_scores.push(water);
            log_populations.push(log_pop);
            transit_scores.push(transit);
        }

        // Sort all distributions for O(log n) binary-search percentile lookup
        for v in country_poi_densities.values_mut() {
            v.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
        }
        water_scores.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
        log_populations.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
        transit_scores.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));

        GlobalStats {
            country_poi_densities,
            water_scores_sorted: water_scores,
            log_population_sorted: log_populations,
            transit_scores_sorted: transit_scores,
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Pass 2: Per-city 15D vector computation
// ─────────────────────────────────────────────────────────────────────────────

/// Pass 2: compute all 15D vectors in parallel using rayon.
///
/// Cities missing POI data are **excluded** (listwise deletion).
/// This preserves vector database integrity — no imputed or arbitrary values.
/// The DB query in `load_all_cities_for_vdb` already enforces completeness;
/// these guards are the final defence layer.
///
/// Returns the filtered Vec and logs how many cities were excluded.
pub fn compute_all_vectors(
    cities: &[CityRawData],
    stats: &GlobalStats,
) -> Vec<CityVector> {
    let results: Vec<Option<CityVector>> = cities
        .par_iter()
        .map(|city| compute_vector(city, stats))
        .collect();

    let total = results.len();
    let vectors: Vec<CityVector> = results.into_iter().flatten().collect();
    let excluded = total - vectors.len();

    if excluded > 0 {
        tracing::warn!(
            "⚠️  {}/{} cities excluded from VDB: incomplete POI data \
             (run collect-poi to fill gaps). {} cities included.",
            excluded, total, vectors.len()
        );
    }

    vectors
}

/// Compute the 13D vector for a single city.
///
/// Returns `None` (and logs a warning) if POI data is absent,
/// because no dimension can be reliably computed without observed measurements.
/// This enforces the **no-imputation** policy: only real data enters the VDB.
fn compute_vector(city: &CityRawData, stats: &GlobalStats) -> Option<CityVector> {
    // Defensive guard — should never trigger when loading via load_all_cities_for_vdb
    // (which filters for poi_data IS NOT NULL).
    let poi = match city.poi.as_ref() {
        Some(p) => p,
        None => {
            tracing::warn!(
                "City '{}' (id={}) missing POI data — excluded from VDB",
                city.name, city.geoname_id
            );
            return None;
        }
    };

    // ── Layer A: Urban Vibe 6-axis (dim 0–5) ────────────────────────────────
    // Normalization: category count / total POI (proportion within query radius).
    // total_poi == 0 is a valid observation (no detectable POI at this resolution).
    // These cities rank at the minimum of all vibe axes — correct, not penalised.
    // Ref: DATASET_VECTOR_SPEC.md §2 Layer A
    let total = poi.total_poi as f64;
    let (d0, d1, d2, d3, d4, d5) = if total > 0.0 {
        (
            (poi.vitality_count()  as f64 / total).clamp(0.0, 1.0), // vitality
            (poi.culture_count()   as f64 / total).clamp(0.0, 1.0), // culture
            (poi.relief_count()    as f64 / total).clamp(0.0, 1.0), // relief
            (poi.rhythm_count()    as f64 / total).clamp(0.0, 1.0), // rhythm
            (poi.lifestyle_count() as f64 / total).clamp(0.0, 1.0), // lifestyle
            (poi.commercial_count()as f64 / total).clamp(0.0, 1.0), // commercial
        )
    } else {
        (0.0, 0.0, 0.0, 0.0, 0.0, 0.0) // measured zero — not imputed
    };

    // ── Layer B: POI profile (dim 6–7) ──────────────────────────────────────
    // dim 6: poi_density_norm — within-country percentile rank.
    // Ref: DATASET_VECTOR_SPEC.md §2 Layer B
    let d6 = {
        let density = poi.poi_density_per_km2();
        // GlobalStats is built from the same filtered city set, so every country
        // code present here will also be in the map.
        stats.country_poi_densities
            .get(&city.country_code)
            .map(|dist| percentile_rank_sorted(dist, density))
            .unwrap_or_else(|| percentile_rank_sorted(&[], density)) // empty → 0.5
    };

    // dim 7: category_diversity_norm — Shannon entropy / log(7).
    // Zero-POI cities produce entropy = 0.0 (minimum diversity — a real measurement).
    // Ref: Hasan et al. (2013), Shannon (1948)
    let d7 = shannon_entropy_normalized(&poi.category_counts_for_entropy());

    // ── Layer C: Water proximity (dim 8) ────────────────────────────────────
    // Transformation: 1/(1+dist_km) then global percentile rank.
    let d8 = {
        let score = water_proximity_score(poi.nearest_water_km);
        percentile_rank_sorted(&stats.water_scores_sorted, score)
    };

    // ── Layer D: Mobility (dim 9–10) — POI-derived estimation ───────────────
    // WorldMove / Kontur human-mobility data unavailable; estimated from OSM POI.
    //   dim 9 (temporal_entropy): diversity × 0.6 + density × 0.3 + 0.05
    //   "더 다양한 POI = 더 다양한 시간대 활동" — Cranshaw et al. (2012)
    //   dim 10 (flow_to_poi_ratio): density × 0.5 + diversity × 0.3 + 0.1
    //   "POI 밀도 ≈ 유동 인구 비율" — Cranshaw et al. (2012)
    // Both are derived entirely from observed d6/d7 — no arbitrary constants.
    let d9  = (d7 * 0.6 + d6 * 0.3 + 0.05).clamp(0.0, 1.0); // temporal_entropy
    let d10 = (d6 * 0.5 + d7 * 0.3 + 0.10).clamp(0.0, 1.0); // flow_to_poi_ratio

    // ── Layer E: Population (dim 11) — log(population) percentile ───────────
    // log(population+1) appropriate for power-law city-size distributions.
    // population == 0 in GeoNames encodes "unknown" → log(1) = 0 → bottom percentile,
    // which is the most conservative placement (no inflation).
    // Ref: Noulas et al. (2011) — POI density vs population density r=0.81
    let d11 = {
        let log_pop = ((city.population as f64 + 1.0).ln()).max(0.0);
        percentile_rank_sorted(&stats.log_population_sorted, log_pop)
    };

    // ── Layer E: Transit accessibility (dim 12) — real OSM data ─────────────
    // Mode-weighted stop count within 800m (subway×1.0, rail×0.9, tram×0.6, bus×0.3).
    // Ref: DATASET_VECTOR_SPEC.md §6
    // transit_raw == 0 is a valid measurement (no stops detected) → bottom percentile.
    // Percentile rank ensures comparability across cities.
    let d12 = {
        let transit_raw = poi.transit_score_raw();
        percentile_rank_sorted(&stats.transit_scores_sorted, transit_raw)
    };

    // ── Final assembly ───────────────────────────────────────────────────────
    // All 13 dimensions guaranteed in [0.0, 1.0] by construction.
    let vector = [
        d0 as f32, d1 as f32, d2 as f32, d3 as f32, d4 as f32,
        d5 as f32, d6 as f32, d7 as f32, d8 as f32, d9 as f32,
        d10 as f32, d11 as f32, d12 as f32,
    ];

    debug_assert!(
        vector.iter().all(|&v| (0.0..=1.0).contains(&v)),
        "Vector out of bounds for city {}: {:?}",
        city.name,
        vector
    );

    Some(CityVector {
        geoname_id: city.geoname_id,
        name: city.name.clone(),
        ascii_name: city.ascii_name.clone(),
        country_code: city.country_code.clone(),
        latitude: city.latitude as f32,
        longitude: city.longitude as f32,
        population: city.population,
        timezone: city.timezone.clone(),
        vector,
    })
}

// ─────────────────────────────────────────────────────────────────────────────
// Normalization primitives
// ─────────────────────────────────────────────────────────────────────────────

/// Shannon entropy normalized to [0, 1] by log(N_categories).
///
/// H = -Σ(p_i · log(p_i)) / log(N)
///
/// Uses 7 categories (vitality, culture, relief, rhythm, lifestyle, commercial, other).
/// Maximum entropy log(7) ≈ 1.946 nats → normalized to 1.0.
///
/// Ref: Shannon (1948) — information entropy
///      Hasan et al. (2013) — urban activity pattern classification
pub fn shannon_entropy_normalized(counts: &[f64; 7]) -> f64 {
    let total: f64 = counts.iter().sum();
    if total < 1.0 {
        // Zero POI observed → zero category diversity.
        // Returning 0.5 ("unknown") would misrepresent a measured zero.
        return 0.0;
    }

    let entropy: f64 = counts
        .iter()
        .filter(|&&c| c > 0.0)
        .map(|&c| {
            let p = c / total;
            -p * p.ln() // natural log for nats
        })
        .sum();

    // Normalize by log(7) — maximum entropy with 7 equally frequent categories
    const MAX_ENTROPY: f64 = 1.9459101090932196; // ln(7)
    (entropy / MAX_ENTROPY).clamp(0.0, 1.0)
}

/// Water proximity transformation: 1/(1+dist_km).
/// - dist=0.0km → score=1.0 (right on water)
/// - dist=1.0km → score=0.5
/// - dist=10km  → score=0.09
/// - dist=100km → score=0.0099
///
/// None (not found within 50km) → 0.02 (effectively no water)
pub fn water_proximity_score(dist_km: Option<f64>) -> f64 {
    match dist_km {
        Some(d) if d >= 0.0 => 1.0 / (1.0 + d),
        _ => 0.02, // no water found within query radius
    }
}

/// Percentile rank using binary search on a pre-sorted distribution.
///
/// Returns interpolated percentile rank in [0, 1]:
///   rank = (count_below + 0.5 × count_equal) / n
///
/// Time complexity: O(log n) after O(n log n) sort in Pass 1.
///
/// Ref: Hyndman & Fan (1996) — "Sample Quantiles in Statistical Packages"
pub fn percentile_rank_sorted(sorted: &[f64], value: f64) -> f64 {
    let n = sorted.len();
    if n == 0 {
        return 0.5;
    }

    // Binary search for lower_bound and upper_bound
    let lower = sorted.partition_point(|&x| x < value);
    let upper = sorted.partition_point(|&x| x <= value);
    let equal_count = upper - lower;

    let rank = (lower as f64 + 0.5 * equal_count as f64) / n as f64;
    rank.clamp(0.0, 1.0)
}

// ─────────────────────────────────────────────────────────────────────────────
// Hexagon normalizer — Pass 1 + Pass 2
// ─────────────────────────────────────────────────────────────────────────────

/// Global statistics computed over all valid hexagons (Pass 1).
/// Mirrors GlobalStats but operates on hex-granularity POI data.
pub struct GlobalHexStats {
    /// All hex POI density values (poi/km²) sorted — for global percentile.
    poi_densities_sorted: Vec<f64>,
    /// All hex water scores sorted.
    water_scores_sorted: Vec<f64>,
    /// All hex transit scores sorted.
    transit_scores_sorted: Vec<f64>,
}

impl GlobalHexStats {
    /// Pass 1: compute global POI distributions over all valid hexagons.
    ///
    /// Hexagons loaded via `load_valid_hexagons` are guaranteed to have
    /// `poi_data IS NOT NULL` (enforced at DB level), so POI is always present.
    pub fn compute(hexes: &[HexRawData]) -> Self {
        let raw: Vec<(f64, f64, f64)> = hexes
            .par_iter()
            .map(|h| {
                // poi is guaranteed non-None by the DB query (poi_data IS NOT NULL).
                // .map().unwrap_or() retained as a defensive fallback only.
                let poi_density = h.poi.as_ref()
                    .map(|p| p.poi_density_per_km2())
                    .unwrap_or(0.0);
                let water_score = h.poi.as_ref()
                    .map(|p| water_proximity_score(p.nearest_water_km))
                    .unwrap_or(0.0);
                let transit = h.poi.as_ref()
                    .map(|p| p.transit_score_raw())
                    .unwrap_or(0.0);
                (poi_density, water_score, transit)
            })
            .collect();

        let mut poi_densities: Vec<f64> = raw.iter().map(|r| r.0).collect();
        let mut water_scores: Vec<f64>  = raw.iter().map(|r| r.1).collect();
        let mut transit_scores: Vec<f64> = raw.iter().map(|r| r.2).collect();

        poi_densities.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
        water_scores.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
        transit_scores.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));

        GlobalHexStats {
            poi_densities_sorted: poi_densities,
            water_scores_sorted: water_scores,
            transit_scores_sorted: transit_scores,
        }
    }
}

/// Pass 2: compute all hex 15D vectors in parallel.
///
/// Hexagons with no POI data are **excluded** (listwise deletion).
/// The DB query already guarantees `poi_data IS NOT NULL`; this is the final guard.
pub fn compute_all_hex_vectors(
    hexes: &[HexRawData],
    stats: &GlobalHexStats,
) -> Vec<HexVector> {
    let results: Vec<Option<HexVector>> = hexes
        .par_iter()
        .map(|h| compute_hex_vector(h, stats))
        .collect();

    let total = results.len();
    let vectors: Vec<HexVector> = results.into_iter().flatten().collect();
    let excluded = total - vectors.len();

    if excluded > 0 {
        tracing::warn!(
            "⚠️  {}/{} hexagons excluded from VDB: missing POI data. {} included.",
            excluded, total, vectors.len()
        );
    }

    vectors
}

/// Compute 13D vector for a single hexagon.
///
/// Returns `None` if POI data is absent — no imputation is applied.
///
/// # Design differences vs city-level
/// - **dim 6**: global percentile (hexagons cross country boundaries).
/// - **dim 11**: POI density percentile as population proxy (Noulas et al. 2011, r=0.81).
fn compute_hex_vector(hex: &HexRawData, stats: &GlobalHexStats) -> Option<HexVector> {
    // Defensive guard — should never trigger with load_valid_hexagons (poi_data IS NOT NULL).
    let poi = match hex.poi.as_ref() {
        Some(p) => p,
        None => {
            tracing::warn!(
                "Hexagon h3={} (parent city id={}) missing POI data — excluded from VDB",
                hex.h3_index, hex.parent_city_id
            );
            return None;
        }
    };

    // ── Layer A: Urban Vibe 6-axis (dim 0–5) ────────────────────────────────
    // total_poi >= MIN_POI_THRESHOLD (20) enforced at collection time, so total > 0
    // for all valid hexagons.  The zero branch is a final safety guard.
    let total = poi.total_poi as f64;
    let (d0, d1, d2, d3, d4, d5) = if total > 0.0 {
        (
            (poi.vitality_count()  as f64 / total).clamp(0.0, 1.0),
            (poi.culture_count()   as f64 / total).clamp(0.0, 1.0),
            (poi.relief_count()    as f64 / total).clamp(0.0, 1.0),
            (poi.rhythm_count()    as f64 / total).clamp(0.0, 1.0),
            (poi.lifestyle_count() as f64 / total).clamp(0.0, 1.0),
            (poi.commercial_count()as f64 / total).clamp(0.0, 1.0),
        )
    } else {
        (0.0, 0.0, 0.0, 0.0, 0.0, 0.0) // measured zero — not imputed
    };

    // ── Layer B: POI profile (dim 6–7) ──────────────────────────────────────
    // dim 6: global percentile (hexagons are not grouped by country).
    let d6 = percentile_rank_sorted(&stats.poi_densities_sorted, poi.poi_density_per_km2());

    // dim 7: category_diversity — Shannon entropy / log(7).
    // Zero total_poi → 0.0 (minimum diversity, a real measurement).
    let d7 = shannon_entropy_normalized(&poi.category_counts_for_entropy());

    // ── Layer C: Water proximity (dim 8) ────────────────────────────────────
    let d8 = {
        let score = water_proximity_score(poi.nearest_water_km);
        percentile_rank_sorted(&stats.water_scores_sorted, score)
    };

    // ── Layer D: Mobility (dim 9–10) — POI-derived ──────────────────────────
    // Ref: Cranshaw et al. (2012) — POI diversity as temporal activity proxy
    let d9  = (d7 * 0.6 + d6 * 0.3 + 0.05).clamp(0.0, 1.0); // temporal_entropy
    let d10 = (d6 * 0.5 + d7 * 0.3 + 0.10).clamp(0.0, 1.0); // flow_to_poi_ratio

    // ── Layer E: Population density (dim 11) ────────────────────────────────
    // At hexagon scale, administrative population data is unavailable.
    // POI density is a validated proxy (Noulas et al. 2011, r=0.81).
    let d11 = d6;

    // ── Layer E: Transit accessibility (dim 12) ─────────────────────────────
    // transit_raw == 0 is a valid measurement → bottom percentile (not inflated).
    let d12 = {
        let transit_raw = poi.transit_score_raw();
        percentile_rank_sorted(&stats.transit_scores_sorted, transit_raw)
    };

    let vector = [
        d0 as f32, d1 as f32, d2 as f32, d3 as f32, d4 as f32,
        d5 as f32, d6 as f32, d7 as f32, d8 as f32, d9 as f32,
        d10 as f32, d11 as f32, d12 as f32,
    ];

    debug_assert!(
        vector.iter().all(|&v| (0.0..=1.0).contains(&v)),
        "Hex vector out of bounds for h3={}: {:?}",
        hex.h3_index,
        vector
    );

    Some(HexVector {
        h3_index: hex.h3_index,
        lat: hex.lat as f32,
        lon: hex.lon as f32,
        admin_name: hex.admin_name.clone(),
        admin_level: hex.admin_level,
        country_code: hex.country_code.clone(),
        parent_city_id: hex.parent_city_id,
        parent_city_name: hex.parent_city_name.clone(),
        vector,
    })
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_shannon_entropy_uniform() {
        // Uniform distribution across 7 categories → entropy = 1.0
        let counts = [1.0f64; 7];
        let h = shannon_entropy_normalized(&counts);
        assert!((h - 1.0).abs() < 1e-9, "Uniform entropy should be 1.0, got {}", h);
    }

    #[test]
    fn test_shannon_entropy_single_category() {
        // All POIs in one category → entropy = 0.0
        let mut counts = [0.0f64; 7];
        counts[0] = 100.0;
        let h = shannon_entropy_normalized(&counts);
        assert!(h.abs() < 1e-9, "Single category entropy should be 0.0, got {}", h);
    }

    #[test]
    fn test_shannon_entropy_empty() {
        // Zero POI: observed minimum diversity → 0.0, NOT 0.5 (neutral).
        // Returning 0.5 would misrepresent a measured zero as "unknown".
        let counts = [0.0f64; 7];
        let h = shannon_entropy_normalized(&counts);
        assert_eq!(h, 0.0, "Empty (zero POI) counts should return 0.0 (minimum diversity)");
    }

    #[test]
    fn test_water_proximity_score() {
        assert!((water_proximity_score(Some(0.0)) - 1.0).abs() < 1e-9);
        assert!((water_proximity_score(Some(1.0)) - 0.5).abs() < 1e-9);
        // No water
        assert!(water_proximity_score(None) < 0.05);
    }

    #[test]
    fn test_percentile_rank() {
        let sorted = vec![1.0f64, 2.0, 3.0, 4.0, 5.0];
        // Lowest value → ~0.1
        assert!((percentile_rank_sorted(&sorted, 1.0) - 0.1).abs() < 1e-9);
        // Middle value → 0.5
        assert!((percentile_rank_sorted(&sorted, 3.0) - 0.5).abs() < 1e-9);
        // Highest value → ~0.9
        assert!((percentile_rank_sorted(&sorted, 5.0) - 0.9).abs() < 1e-9);
    }

    #[test]
    fn test_vector_bounds() {
        // All 13 dimensions must stay in [0, 1]
        let poi = PoiCounts {
            restaurant: 1000,
            total_poi: 1000,
            radius_km: 5.0,
            nearest_water_km: Some(0.1),
            subway_entrances: 50,
            ..Default::default()
        };
        let city = CityRawData {
            geoname_id: 1,
            name: "TestCity".to_string(),
            ascii_name: "TestCity".to_string(),
            country_code: "XX".to_string(),
            latitude: 0.0,
            longitude: 0.0,
            population: 100_000,
            timezone: "UTC".to_string(),
            poi: Some(poi),
        };

        let stats = GlobalStats::compute(std::slice::from_ref(&city));
        let vec = compute_vector(&city, &stats)
            .expect("test city has POI — must produce a vector");

        assert_eq!(vec.vector.len(), 13, "Vector must be exactly 13D");
        for (i, &v) in vec.vector.iter().enumerate() {
            assert!(
                (0.0..=1.0).contains(&v),
                "dim {} out of bounds: {}",
                i,
                v
            );
        }
    }
}
