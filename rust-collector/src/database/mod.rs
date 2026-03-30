//! DuckDB-backed city + hexagon + boundary database.
//!
//! # Why DuckDB over SQLite
//!
//! - **Columnar storage**: `SELECT poi_data FROM hexagons WHERE is_valid = 1`
//!   reads only the `poi_data` column — critical for VDB build with 5M–10M
//!   hex rows.
//! - **Native compression**: repetitive POI JSON fields compress ~4× vs SQLite
//!   TEXT.
//! - **Bulk insert throughput**: 500K+ rows/s vs SQLite's ~10K rows/s.
//! - **Scale**: handles 50M+ rows without tuning (SQLite needs WAL / pragma).
//! - **Parquet export**: built-in — forward-compatible with downstream ML.
//!
//! # Concurrency model
//!
//! DuckDB allows only ONE writer at a time but unlimited readers.
//! [`CityDatabase`] is `Clone + Send + Sync` — each async task opens its own
//! short-lived connection to avoid blocking the Tokio runtime thread.
//! For bulk writes, callers should use the batch variants (e.g.
//! [`CityDatabase::insert_city_batch`]) which wrap rows in a single
//! transaction for ~20× throughput.

// Sub-modules contain `impl CityDatabase` blocks — the methods are
// automatically available on the type declared here in mod.rs.  No
// glob re-exports needed.
mod boundaries;
mod cities;
mod hexagons;
mod maintenance;
mod schema;

use anyhow::{anyhow, Result};
use duckdb::Connection;

/// DuckDB database handle — path-based, connection opened per operation.
#[derive(Clone)]
pub struct CityDatabase {
    path: std::path::PathBuf,
}

// ── Stats structs ────────────────────────────────────────────────────────────

/// Summary statistics for the cities table.
#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub struct DbStats {
    pub total: usize,
    pub with_weather: usize,
    pub with_country: usize,
    pub complete: usize,
    pub incomplete: usize,
}

impl DbStats {
    /// Percentage of cities passing validation (0.0–100.0).
    pub fn validation_rate(&self) -> f64 {
        if self.total == 0 {
            0.0
        } else {
            (self.complete as f64 / self.total as f64) * 100.0
        }
    }
}

/// Summary statistics for the hexagons table.
#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub struct HexStats {
    pub total: usize,
    pub valid: usize,
    pub cities_covered: usize,
    pub admin_areas: usize,
}

/// Integrity report for hexagon data gaps.
///
/// Used by the update/resume flow to detect what needs re-collection.
#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub struct HexIntegrityReport {
    /// Total hexagons in DB.
    pub total_hexagons: usize,
    /// Hexagons passing POI threshold.
    pub valid_hexagons: usize,
    /// Hexagons with `admin_level == 0` (city-name fallback).
    pub missing_admin: usize,
    /// Hexagons with NULL or empty `poi_data`.
    pub missing_poi: usize,
    /// Country codes that have hexagons but zero boundary polygons downloaded.
    pub gap_boundary_countries: Vec<String>,
    /// Country codes that have hexagons with `admin_level == 0`.
    pub gap_admin_countries: Vec<String>,
}

/// Comprehensive integrity report covering ALL data layers.
///
/// Used by the auto-update flow to detect gaps, missing data, and staleness
/// across every stage of the pipeline.
#[derive(Debug)]
pub struct FullIntegrityReport {
    // ── Layer 1: Cities ──
    /// Total cities in DB.
    pub cities_total: usize,
    /// Cities with `is_valid = 0` or missing `country_info`.
    pub cities_invalid: usize,
    /// New cities in GeoNames file not yet in DB.
    pub cities_new_in_file: usize,

    // ── Layer 2: POI ──
    /// Cities where `poi_data IS NULL`.
    pub cities_without_poi: usize,

    // ── Layer 3: Boundaries ──
    /// Countries with boundary polygons downloaded.
    pub boundary_countries_done: usize,
    /// Country codes from cities that have no boundary data.
    pub boundary_countries_missing: Vec<String>,

    // ── Layer 4: Hexagons ──
    /// Full hexagon sub-report.
    pub hex: HexIntegrityReport,

    // ── Layer 5: VDB freshness ──
    /// True if `cities.edb` exists.
    pub city_vdb_exists: bool,
    /// True if `hexagons.edbh` exists.
    pub hex_vdb_exists: bool,
}

impl FullIntegrityReport {
    /// Returns true when every layer is complete and no gaps remain.
    pub fn is_complete(&self) -> bool {
        self.cities_invalid == 0
            && self.cities_new_in_file == 0
            && self.cities_without_poi == 0
            && self.boundary_countries_missing.is_empty()
            && self.hex.missing_admin == 0
            && self.hex.missing_poi == 0
            && self.city_vdb_exists
            && self.hex_vdb_exists
    }

    /// Returns true if any data layer changed and VDB needs rebuild.
    pub fn needs_city_vdb_rebuild(&self) -> bool {
        !self.city_vdb_exists
            || self.cities_without_poi > 0
            || self.cities_new_in_file > 0
    }

    /// Returns true if hex VDB needs rebuild.
    pub fn needs_hex_vdb_rebuild(&self) -> bool {
        !self.hex_vdb_exists
            || self.hex.missing_admin > 0
            || self.hex.missing_poi > 0
            || !self.boundary_countries_missing.is_empty()
    }
}

/// A POI update row, used by [`CityDatabase::update_poi_batch`].
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct PoiClimateUpdate {
    pub geoname_id: i64,
    pub poi_data: Option<crate::poi::PoiCounts>,
}

// ── CityDatabase core ────────────────────────────────────────────────────────

impl CityDatabase {
    /// Create a new handle.  No connection is opened until an operation is
    /// performed.
    pub async fn new(path: &std::path::Path) -> Result<Self> {
        Ok(Self {
            path: path.to_path_buf(),
        })
    }

    /// Open a DuckDB connection with write-optimised settings.
    pub(crate) fn open(&self) -> Result<Connection> {
        let conn = Connection::open(&self.path)
            .map_err(|e| anyhow!("DuckDB open failed: {}", e))?;
        let _ = conn.execute_batch(
            "PRAGMA threads=4;
             SET preserve_insertion_order=false;",
        );
        Ok(conn)
    }

    /// Run a comprehensive integrity check across ALL data layers.
    ///
    /// Inspects: cities, POI, climate, boundaries, hexagons, and VDB files.
    /// Optionally checks for new cities in `cities_file`.
    pub async fn get_full_integrity_report(
        &self,
        cities_file: Option<&std::path::Path>,
        output_path: &std::path::Path,
    ) -> Result<FullIntegrityReport> {
        // ── Layer 1: Cities ──
        let cities_total = self.get_city_count().await?;
        let cities_invalid = self.find_invalid_cities().await?.len();
        let cities_new_in_file = if let Some(path) = cities_file {
            if path.exists() {
                let file_count = count_lines_in_file(path)?;
                file_count.saturating_sub(cities_total)
            } else {
                0
            }
        } else {
            0
        };

        // ── Layer 2: POI ──
        let cities_without_poi = self.count_cities_without_poi().await?;

        // ── Layer 3: Boundaries ──
        let boundary_done = self.get_downloaded_boundary_countries().await?;
        let all_cities = self.get_all_cities_basic().await?;
        let all_country_codes: std::collections::HashSet<String> = all_cities
            .iter()
            .map(|c| c.country_code.clone())
            .collect();
        let boundary_countries_missing: Vec<String> = all_country_codes
            .iter()
            .filter(|cc| !boundary_done.contains(*cc))
            .cloned()
            .collect();

        // ── Layer 4: Hexagons ──
        let hex = self.get_hex_integrity_report().await?;

        // ── Layer 5: VDB files ──
        let city_vdb_exists = output_path.join("cities.edb").exists();
        let hex_vdb_exists = output_path.join("hexagons.edbh").exists();

        Ok(FullIntegrityReport {
            cities_total,
            cities_invalid,
            cities_new_in_file,
            cities_without_poi,
            boundary_countries_done: boundary_done.len(),
            boundary_countries_missing,
            hex,
            city_vdb_exists,
            hex_vdb_exists,
        })
    }
}

/// Count non-comment lines in a GeoNames TSV file.
fn count_lines_in_file(path: &std::path::Path) -> Result<usize> {
    use std::io::BufRead;
    let file = std::fs::File::open(path)
        .map_err(|e| anyhow!("cannot open {}: {}", path.display(), e))?;
    let reader = std::io::BufReader::new(file);
    let count = reader
        .lines()
        .filter_map(|l| l.ok())
        .filter(|l| !l.starts_with('#') && !l.trim().is_empty())
        .count();
    Ok(count)
}
