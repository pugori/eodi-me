//! Hexagon CRUD operations and statistics.

use anyhow::{anyhow, Result};
use duckdb::params;
use tracing::info;

use super::{CityDatabase, HexStats};
use crate::hexagon::HexRecord;

impl CityDatabase {
    /// Bulk upsert hexagon records inside a single transaction.
    ///
    /// Typical throughput: ~300–500K rows/s — a city with 300 hexagons
    /// takes <1ms.
    pub async fn upsert_hexagons(&self, records: &[HexRecord]) -> Result<()> {
        if records.is_empty() {
            return Ok(());
        }

        let conn = self.open()?;
        conn.execute_batch("BEGIN")
            .map_err(|e| anyhow!("{}", e))?;

        {
            let mut stmt = conn
                .prepare(
                    "INSERT OR REPLACE INTO hexagons
                        (h3_index, lat, lon, admin_name, admin_level, overlap_ratio,
                         parent_city_id, parent_city_name, poi_data, is_valid,
                         updated_at)
                     VALUES (?,?,?,?,?,?,?,?,?,?, CURRENT_TIMESTAMP)",
                )
                .map_err(|e| anyhow!("prepare upsert_hexagons: {}", e))?;

            for rec in records {
                let poi_json = serde_json::to_string(&rec.poi)
                    .map_err(|e| anyhow!("poi JSON: {}", e))?;

                stmt.execute(params![
                    rec.h3_index,
                    rec.lat,
                    rec.lon,
                    rec.admin_name,
                    rec.admin_level,
                    rec.overlap_ratio,
                    rec.parent_city_id,
                    rec.parent_city_name,
                    poi_json,
                    rec.is_valid,
                ])
                .map_err(|e| anyhow!("upsert hexagon row: {}", e))?;
            }
        }

        conn.execute_batch("COMMIT")
            .map_err(|e| anyhow!("{}", e))?;
        Ok(())
    }

    /// City IDs that already have hexagons — for bulk resume.
    pub async fn get_hexagonized_city_ids(
        &self,
    ) -> Result<std::collections::HashSet<i64>> {
        let conn = self.open()?;
        let mut stmt = conn
            .prepare("SELECT DISTINCT parent_city_id FROM hexagons")
            .map_err(|e| anyhow!("{}", e))?;

        let ids = stmt
            .query_map([], |row| row.get::<_, i64>(0))
            .map_err(|e| anyhow!("{}", e))?
            .filter_map(|r| r.ok())
            .collect();
        Ok(ids)
    }

    /// H3 indexes already collected for a specific parent city.
    pub async fn get_collected_hex_ids_for_city(
        &self,
        city_id: i64,
    ) -> Result<std::collections::HashSet<u64>> {
        let conn = self.open()?;
        // Only return VALID hexagons (is_valid = true) for the resume check.
        // Cities where all hexagons are invalid (zero POI) will have an empty
        // result here, so --resume will retry them instead of skipping.
        let mut stmt = conn
            .prepare(
                "SELECT h3_index FROM hexagons
                 WHERE parent_city_id = ? AND is_valid = true",
            )
            .map_err(|e| anyhow!("{}", e))?;

        let ids = stmt
            .query_map(params![city_id], |row| row.get::<_, u64>(0))
            .map_err(|e| anyhow!("{}", e))?
            .filter_map(|r| r.ok())
            .collect();
        Ok(ids)
    }

    /// Summary statistics for the hexagons table.
    pub async fn get_hex_stats(&self) -> Result<HexStats> {
        let conn = self.open()?;

        let total: usize = conn
            .query_row("SELECT COUNT(*) FROM hexagons", [], |r| r.get(0))
            .map_err(|e| anyhow!("{}", e))?;
        let valid: usize = conn
            .query_row(
                &format!(
                    "SELECT COUNT(*)
                     FROM hexagons
                     WHERE poi_data IS NOT NULL
                       AND poi_data <> ''
                       AND COALESCE(TRY_CAST(json_extract_string(poi_data, '$.total_poi') AS INTEGER), 0) >= {}",
                    crate::hexagon::MIN_POI_THRESHOLD
                ),
                [],
                |r| r.get(0),
            )
            .map_err(|e| anyhow!("{}", e))?;
        let cities_covered: usize = conn
            .query_row(
                "SELECT COUNT(DISTINCT parent_city_id) FROM hexagons",
                [],
                |r| r.get(0),
            )
            .map_err(|e| anyhow!("{}", e))?;
        let admin_areas: usize = conn
            .query_row(
                &format!(
                    "SELECT COUNT(DISTINCT admin_name)
                     FROM hexagons
                     WHERE poi_data IS NOT NULL
                       AND poi_data <> ''
                       AND COALESCE(TRY_CAST(json_extract_string(poi_data, '$.total_poi') AS INTEGER), 0) >= {}",
                    crate::hexagon::MIN_POI_THRESHOLD
                ),
                [],
                |r| r.get(0),
            )
            .map_err(|e| anyhow!("{}", e))?;

        Ok(HexStats {
            total,
            valid,
            cities_covered,
            admin_areas,
        })
    }

    /// Load all valid hexagons for vector computation.
    ///
    /// DuckDB columnar scan: only 8 columns are read from disk.
    pub async fn load_valid_hexagons(
        &self,
    ) -> Result<Vec<crate::normalizer::HexRawData>> {
        let conn = self.open()?;
        let threshold = crate::hexagon::MIN_POI_THRESHOLD as i64;
        let mut stmt = conn
            .prepare(
                                "SELECT h.h3_index, h.lat, h.lon, h.admin_name, h.admin_level,
                                                COALESCE(c.country_code, ''),
                                                h.parent_city_id, h.parent_city_name, h.poi_data
                                 FROM hexagons h
                                 LEFT JOIN cities c ON h.parent_city_id = c.geoname_id
                 WHERE h.poi_data IS NOT NULL
                   AND h.poi_data <> ''
                   AND COALESCE(TRY_CAST(json_extract_string(h.poi_data, '$.total_poi') AS INTEGER), 0) >= ?
                                 ORDER BY h.h3_index",
            )
            .map_err(|e| anyhow!("{}", e))?;

        let rows = stmt
            .query_map(params![threshold], |row| {
                let poi_json: Option<String> = row.get(8)?;
                let poi = poi_json.and_then(|j| serde_json::from_str(&j).ok());

                Ok(crate::normalizer::HexRawData {
                    h3_index: row.get::<_, u64>(0)?,
                    lat: row.get(1)?,
                    lon: row.get(2)?,
                    admin_name: row.get(3)?,
                    admin_level: row.get::<_, u8>(4)?,
                    country_code: row.get(5)?,
                    parent_city_id: row.get(6)?,
                    parent_city_name: row.get(7)?,
                    poi,
                })
            })
            .map_err(|e| anyhow!("{}", e))?
            .filter_map(|r| r.ok())
            .collect();

        Ok(rows)
    }

    /// Export valid hexagons to Parquet (ZSTD compressed).
    ///
    /// Ideal for downstream ML — load directly with pandas/polars/numpy:
    /// ```python
    /// df = pd.read_parquet("hexagons.parquet")
    /// ```
    pub async fn export_hexagons_parquet(
        &self,
        output_path: &std::path::Path,
    ) -> Result<()> {
        let conn = self.open()?;
        let sql = format!(
            "COPY (
                SELECT h3_index, lat, lon, admin_name, admin_level,
                       parent_city_id, parent_city_name, poi_data
                FROM hexagons WHERE is_valid = true
                ORDER BY h3_index
             ) TO '{}' (FORMAT PARQUET, COMPRESSION ZSTD)",
            output_path.to_string_lossy().replace('\\', "/")
        );

        conn.execute_batch(&sql)
            .map_err(|e| anyhow!("Parquet export failed: {}", e))?;

        let size = std::fs::metadata(output_path)?.len();
        info!(
            "📦 Parquet export → {:?} ({:.1} MB, ZSTD)",
            output_path,
            size as f64 / 1_048_576.0
        );
        Ok(())
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Integrity check & gap detection
    // ─────────────────────────────────────────────────────────────────────────

    /// Run a full integrity check on the hexagons table.
    ///
    /// Detects:
    /// - Hexagons with `admin_level == 0` (missing admin boundary)
    /// - Hexagons with NULL/empty `poi_data`
    /// - Countries with hexagons but no downloaded boundary polygons
    /// - Countries where hexagons fell back to city name
    pub async fn get_hex_integrity_report(&self) -> Result<super::HexIntegrityReport> {
        let conn = self.open()?;

        let total_hexagons: usize = conn
            .query_row("SELECT COUNT(*) FROM hexagons", [], |r| r.get(0))
            .map_err(|e| anyhow!("{}", e))?;

        let valid_hexagons: usize = conn
            .query_row(
                &format!(
                    "SELECT COUNT(*)
                     FROM hexagons
                     WHERE poi_data IS NOT NULL
                       AND poi_data <> ''
                       AND COALESCE(TRY_CAST(json_extract_string(poi_data, '$.total_poi') AS INTEGER), 0) >= {}",
                    crate::hexagon::MIN_POI_THRESHOLD
                ),
                [],
                |r| r.get(0),
            )
            .map_err(|e| anyhow!("{}", e))?;

        let missing_admin: usize = conn
            .query_row(
                "SELECT COUNT(*) FROM hexagons WHERE admin_level = 0 AND is_valid = true",
                [],
                |r| r.get(0),
            )
            .map_err(|e| anyhow!("{}", e))?;

        let missing_poi: usize = conn
            .query_row(
                "SELECT COUNT(*) FROM hexagons WHERE poi_data IS NULL OR poi_data = ''",
                [],
                |r| r.get(0),
            )
            .map_err(|e| anyhow!("{}", e))?;

        // Countries with hexagons that have no boundary data at all.
        let mut stmt_gap_boundary = conn
            .prepare(
                "SELECT DISTINCT c.country_code
                 FROM hexagons h
                 JOIN cities c ON h.parent_city_id = c.geoname_id
                 WHERE c.country_code NOT IN (
                     SELECT DISTINCT country_code FROM boundaries
                 )
                 ORDER BY c.country_code",
            )
            .map_err(|e| anyhow!("{}", e))?;
        let gap_boundary_countries: Vec<String> = stmt_gap_boundary
            .query_map([], |row| row.get(0))
            .map_err(|e| anyhow!("{}", e))?
            .filter_map(|r| r.ok())
            .collect();

        // Countries where hexagons have admin_level == 0 (only valid hexagons matter for VDB).
        let mut stmt_gap_admin = conn
            .prepare(
                "SELECT DISTINCT c.country_code
                 FROM hexagons h
                 JOIN cities c ON h.parent_city_id = c.geoname_id
                 WHERE h.admin_level = 0 AND h.is_valid = true
                 ORDER BY c.country_code",
            )
            .map_err(|e| anyhow!("{}", e))?;
        let gap_admin_countries: Vec<String> = stmt_gap_admin
            .query_map([], |row| row.get(0))
            .map_err(|e| anyhow!("{}", e))?
            .filter_map(|r| r.ok())
            .collect();

        Ok(super::HexIntegrityReport {
            total_hexagons,
            valid_hexagons,
            missing_admin,
            missing_poi,
            gap_boundary_countries,
            gap_admin_countries,
        })
    }

    /// Recompute `is_valid` from `poi_data.total_poi` using current threshold.
    ///
    /// This is a safety repair for legacy DB states where `is_valid` may be stale
    /// even though POI JSON data exists.
    pub async fn recompute_hex_validity_from_poi(&self, min_poi_threshold: u32) -> Result<usize> {
        let conn = self.open()?;

        let before_valid: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM hexagons WHERE is_valid = true OR is_valid = 1",
                [],
                |r| r.get(0),
            )
            .map_err(|e| anyhow!("{}", e))?;

        let sql = format!(
            "UPDATE hexagons
             SET is_valid = CASE
                 WHEN poi_data IS NULL OR poi_data = '' THEN false
                 WHEN COALESCE(TRY_CAST(json_extract_string(poi_data, '$.total_poi') AS INTEGER), 0) >= {} THEN true
                 ELSE false
             END",
            min_poi_threshold
        );
        conn.execute_batch(&sql)
            .map_err(|e| anyhow!("recompute hex validity: {}", e))?;

        let after_valid: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM hexagons WHERE is_valid = true OR is_valid = 1",
                [],
                |r| r.get(0),
            )
            .map_err(|e| anyhow!("{}", e))?;

        let changed = (after_valid - before_valid).unsigned_abs() as usize;
        Ok(changed)
    }

    /// Backfill `poi_data` in hexagons from the parent city's collected POI.
    ///
    /// This repairs the case where `assign_global_hexagons_by_country` ran
    /// without `.hex_poi_ckpt` files, leaving all hexagons with `total_poi=0`.
    /// Copies city.poi_data → hexagon.poi_data for every hexagon whose
    /// poi_data currently has total_poi=0 and whose parent city has POI data.
    /// Returns the number of hexagons updated.
    pub async fn backfill_hex_poi_from_city_data(&self, min_poi_threshold: u32) -> Result<usize> {
        let conn = self.open()?;

        // Count hexagons that need backfill (total_poi = 0 / NULL)
        let needs_backfill: i64 = conn
            .query_row(
                &format!(
                    "SELECT COUNT(*) FROM hexagons h
                     WHERE COALESCE(TRY_CAST(json_extract_string(h.poi_data, '$.total_poi') AS INTEGER), 0) < {}",
                    min_poi_threshold
                ),
                [],
                |r| r.get(0),
            )
            .map_err(|e| anyhow!("{}", e))?;

        if needs_backfill == 0 {
            return Ok(0);
        }

        let sql = format!(
            "UPDATE hexagons
             SET poi_data = c.poi_data,
                 is_valid = CASE
                     WHEN c.poi_data IS NULL OR c.poi_data = '' THEN false
                     WHEN COALESCE(TRY_CAST(json_extract_string(c.poi_data, '$.total_poi') AS INTEGER), 0) >= {} THEN true
                     ELSE false
                 END
             FROM cities c
             WHERE hexagons.parent_city_id = c.geoname_id
               AND c.poi_data IS NOT NULL
               AND c.poi_data <> ''
               AND COALESCE(TRY_CAST(json_extract_string(c.poi_data, '$.total_poi') AS INTEGER), 0) >= {}
               AND COALESCE(TRY_CAST(json_extract_string(hexagons.poi_data, '$.total_poi') AS INTEGER), 0) < {}",
            min_poi_threshold, min_poi_threshold, min_poi_threshold
        );
        conn.execute_batch(&sql)
            .map_err(|e| anyhow!("backfill hex poi: {}", e))?;

        // Count how many were updated
        let updated: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM hexagons WHERE is_valid = true OR is_valid = 1",
                [],
                |r| r.get(0),
            )
            .map_err(|e| anyhow!("{}", e))?;

        Ok(updated as usize)
    }


    /// Load hexagons with `admin_level == 0` for re-assignment.
    pub async fn load_gap_hexagons(&self) -> Result<Vec<crate::hexagon::HexRecord>> {
        let conn = self.open()?;
        let mut stmt = conn
            .prepare(
                "SELECT h3_index, lat, lon, admin_name, admin_level, overlap_ratio,
                        parent_city_id, parent_city_name, poi_data, is_valid
                 FROM hexagons
                 WHERE admin_level = 0",
            )
            .map_err(|e| anyhow!("{}", e))?;

        let rows = stmt
            .query_map([], |row| {
                let poi_json: Option<String> = row.get(8)?;
                let poi: crate::poi::PoiCounts = poi_json
                    .and_then(|j| serde_json::from_str(&j).ok())
                    .unwrap_or_default();

                Ok(crate::hexagon::HexRecord {
                    h3_index: row.get::<_, u64>(0)?,
                    lat: row.get(1)?,
                    lon: row.get(2)?,
                    admin_name: row.get(3)?,
                    admin_level: row.get::<_, u8>(4)?,
                    overlap_ratio: row.get(5)?,
                    parent_city_id: row.get(6)?,
                    parent_city_name: row.get(7)?,
                    poi,
                    is_valid: row.get(9)?,
                })
            })
            .map_err(|e| anyhow!("{}", e))?
            .filter_map(|r| r.ok())
            .collect();

        Ok(rows)
    }

    /// Load gap hexagons (admin_level == 0) for a specific country code.
    pub async fn load_gap_hexagons_for_country(&self, cc: &str) -> Result<Vec<crate::hexagon::HexRecord>> {
        let conn = self.open()?;
        let sql = format!(
            "SELECT h.h3_index, h.lat, h.lon, h.admin_name, h.admin_level, h.overlap_ratio,
                    h.parent_city_id, h.parent_city_name, h.poi_data, h.is_valid
             FROM hexagons h
             JOIN cities c ON h.parent_city_id = c.geoname_id
             WHERE h.admin_level = 0 AND h.is_valid = true AND c.country_code = '{}'",
            cc.replace('\'', "''")
        );
        let mut stmt = conn.prepare(&sql).map_err(|e| anyhow!("{}", e))?;

        let rows = stmt
            .query_map([], |row| {
                let poi_json: Option<String> = row.get(8)?;
                let poi: crate::poi::PoiCounts = poi_json
                    .and_then(|j| serde_json::from_str(&j).ok())
                    .unwrap_or_default();

                Ok(crate::hexagon::HexRecord {
                    h3_index: row.get::<_, u64>(0)?,
                    lat: row.get(1)?,
                    lon: row.get(2)?,
                    admin_name: row.get(3)?,
                    admin_level: row.get::<_, u8>(4)?,
                    overlap_ratio: row.get(5)?,
                    parent_city_id: row.get(6)?,
                    parent_city_name: row.get(7)?,
                    poi,
                    is_valid: row.get(9)?,
                })
            })
            .map_err(|e| anyhow!("{}", e))?
            .filter_map(|r| r.ok())
            .collect();

        Ok(rows)
    }

    /// Get distinct country codes that have gap hexagons (admin_level == 0).
    pub async fn get_gap_hexagon_countries(&self) -> Result<Vec<String>> {
        let conn = self.open()?;
        let mut stmt = conn
            .prepare(
                "SELECT DISTINCT c.country_code
                 FROM hexagons h
                 JOIN cities c ON h.parent_city_id = c.geoname_id
                 WHERE h.admin_level = 0 AND h.is_valid = true
                 ORDER BY c.country_code",
            )
            .map_err(|e| anyhow!("{}", e))?;
        let rows = stmt
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|e| anyhow!("{}", e))?
            .filter_map(|r| r.ok())
            .collect();
        Ok(rows)
    }

    /// Delete ALL hexagons from the table (for clean re-collection).
    pub async fn delete_all_hexagons(&self) -> Result<usize> {
        let conn = self.open()?;
        let count: usize = conn
            .query_row("SELECT COUNT(*) FROM hexagons", [], |r| r.get(0))
            .map_err(|e| anyhow!("{}", e))?;
        conn.execute_batch("DELETE FROM hexagons")
            .map_err(|e| anyhow!("delete all hexagons: {}", e))?;
        Ok(count)
    }

    /// Delete hexagons for specific country codes (via parent city join).
    pub async fn delete_hexagons_for_countries(&self, country_codes: &[String]) -> Result<usize> {
        if country_codes.is_empty() {
            return Ok(0);
        }
        let conn = self.open()?;
        let placeholders: String = country_codes
            .iter()
            .map(|cc| format!("'{}'", cc.replace('\'', "''")))
            .collect::<Vec<_>>()
            .join(",");
        let sql = format!(
            "DELETE FROM hexagons
             WHERE parent_city_id IN (
                 SELECT geoname_id FROM cities WHERE country_code IN ({})
             )",
            placeholders
        );
        let deleted: usize = conn
            .query_row(
                &format!(
                    "SELECT COUNT(*) FROM hexagons
                     WHERE parent_city_id IN (
                         SELECT geoname_id FROM cities WHERE country_code IN ({})
                     )",
                    placeholders
                ),
                [],
                |r| r.get(0),
            )
            .map_err(|e| anyhow!("{}", e))?;
        conn.execute_batch(&sql)
            .map_err(|e| anyhow!("delete hexagons for countries: {}", e))?;
        Ok(deleted)
    }
}
