//! City CRUD operations and statistics.

use anyhow::{anyhow, Context, Result};
use duckdb::params;
use std::collections::HashMap;
use std::path::Path;
use tracing::{debug, info, warn};

use super::{CityDatabase, DbStats, PoiClimateUpdate};

impl CityDatabase {
    // ── Single-row operations ────────────────────────────────────────────

    /// Insert or replace a single city record.
    pub async fn insert_city(&self, city: &crate::city::CityData) -> Result<()> {
        let conn = self.open()?;
        let is_valid = i32::from(city.is_valid());

        conn.execute(
            "INSERT OR REPLACE INTO cities (
                geoname_id, name, ascii_name, latitude, longitude,
                country_code, population, timezone, country_info, weather_info,
                collected_at, is_valid, updated_at
            ) VALUES (?,?,?,?,?,?,?,?,?,NULL,?,?, CURRENT_TIMESTAMP)",
            params![
                city.basic.geoname_id,
                city.basic.name,
                city.basic.ascii_name,
                city.basic.latitude,
                city.basic.longitude,
                city.basic.country_code,
                city.basic.population,
                city.basic.timezone,
                city.country_info,
                city.collected_at.to_rfc3339(),
                is_valid,
            ],
        )
        .with_context(|| {
            format!(
                "insert_city failed for geoname_id={}",
                city.basic.geoname_id
            )
        })?;

        debug!(
            "💾 Saved city: {} ({})",
            city.basic.name, city.basic.geoname_id
        );
        Ok(())
    }

    /// Batch-insert cities in chunked transactions — avoids OOM on large inputs.
    ///
    /// Splits `cities` into chunks of `CHUNK_SIZE` rows, each committed in its
    /// own transaction. A single failed row aborts only that transaction and
    /// is retried one-by-one so no data is lost.
    pub async fn insert_city_batch(&self, cities: &[crate::city::CityData]) -> Result<usize> {
        const CHUNK_SIZE: usize = 2000;
        if cities.is_empty() {
            return Ok(0);
        }

        let mut total_saved = 0usize;

        for chunk in cities.chunks(CHUNK_SIZE) {
            let conn = self.open()?;
            conn.execute_batch("BEGIN")
                .map_err(|e| anyhow!("BEGIN failed: {}", e))?;

            let mut chunk_saved = 0usize;
            let mut chunk_failed = false;

            let stmt_result = conn.prepare(
                "INSERT OR REPLACE INTO cities (
                geoname_id, name, ascii_name, latitude, longitude,
                country_code, population, timezone, country_info, weather_info,
                collected_at, is_valid, updated_at
            ) VALUES (?,?,?,?,?,?,?,?,?,NULL,?,?, CURRENT_TIMESTAMP)",
            );

            match stmt_result {
                Err(e) => {
                    warn!("prepare insert_city_batch chunk: {}", e);
                    let _ = conn.execute_batch("ROLLBACK");
                    continue;
                }
                Ok(mut stmt) => {
                    for city in chunk {
                        let is_valid = i32::from(city.is_valid());
                        match stmt.execute(params![
                            city.basic.geoname_id,
                            city.basic.name,
                            city.basic.ascii_name,
                            city.basic.latitude,
                            city.basic.longitude,
                            city.basic.country_code,
                            city.basic.population,
                            city.basic.timezone,
                            city.country_info,
                            city.collected_at.to_rfc3339(),
                            is_valid,
                        ]) {
                            Ok(_) => chunk_saved += 1,
                            Err(e) => {
                                warn!("Skipping city {} in batch: {}", city.basic.geoname_id, e);
                                chunk_failed = true;
                                break; // abort chunk on first error
                            }
                        }
                    }
                }
            }

            if chunk_failed {
                // Rollback this chunk and fall back to one-by-one inserts
                let _ = conn.execute_batch("ROLLBACK");
                for city in chunk {
                    let conn2 = self.open()?;
                    let is_valid = i32::from(city.is_valid());
                    match conn2.execute(
                        "INSERT OR REPLACE INTO cities (
                            geoname_id, name, ascii_name, latitude, longitude,
                            country_code, population, timezone, country_info, weather_info,
                            collected_at, is_valid, updated_at
                        ) VALUES (?,?,?,?,?,?,?,?,?,NULL,?,?, CURRENT_TIMESTAMP)",
                        params![
                            city.basic.geoname_id,
                            city.basic.name,
                            city.basic.ascii_name,
                            city.basic.latitude,
                            city.basic.longitude,
                            city.basic.country_code,
                            city.basic.population,
                            city.basic.timezone,
                            city.country_info,
                            city.collected_at.to_rfc3339(),
                            is_valid,
                        ],
                    ) {
                        Ok(_) => total_saved += 1,
                        Err(e) => warn!("Skipping city {} (retry): {}", city.basic.geoname_id, e),
                    }
                }
            } else {
                conn.execute_batch("COMMIT")
                    .map_err(|e| anyhow!("COMMIT failed: {}", e))?;
                total_saved += chunk_saved;
                debug!("💾 Chunk saved {} cities", chunk_saved);
            }
        }

        debug!("💾 Total batch saved {} cities", total_saved);
        Ok(total_saved)
    }

    // ── Queries ──────────────────────────────────────────────────────────

    /// Set of all city IDs currently in the database (for resume logic).
    pub async fn get_collected_city_ids(&self) -> Result<std::collections::HashSet<i64>> {
        let conn = self.open()?;
        let mut stmt = conn
            .prepare("SELECT geoname_id FROM cities")
            .map_err(|e| anyhow!("{}", e))?;

        let ids = stmt
            .query_map([], |row| row.get(0))
            .map_err(|e| anyhow!("{}", e))?
            .filter_map(|r| r.ok())
            .collect();
        Ok(ids)
    }

    /// All city IDs, ordered.
    pub async fn get_all_city_ids(&self) -> Result<Vec<i64>> {
        let conn = self.open()?;
        let mut stmt = conn
            .prepare("SELECT geoname_id FROM cities")
            .map_err(|e| anyhow!("{}", e))?;

        let ids = stmt
            .query_map([], |row| row.get(0))
            .map_err(|e| anyhow!("{}", e))?
            .filter_map(|r| r.ok())
            .collect();
        Ok(ids)
    }

    /// Cities that are invalid or missing country_info.
    pub async fn find_invalid_cities(&self) -> Result<Vec<i64>> {
        let conn = self.open()?;
        let mut stmt = conn
            .prepare(
                "SELECT geoname_id FROM cities
                 WHERE is_valid = 0 OR country_info IS NULL",
            )
            .map_err(|e| anyhow!("{}", e))?;

        let ids = stmt
            .query_map([], |row| row.get(0))
            .map_err(|e| anyhow!("{}", e))?
            .filter_map(|r| r.ok())
            .collect();
        Ok(ids)
    }

    /// Load basic info for a set of city IDs.
    pub async fn get_cities_by_ids(
        &self,
        ids: &[i64],
    ) -> Result<Vec<crate::city::CityBasic>> {
        let conn = self.open()?;
        let mut cities = Vec::new();

        for &id in ids {
            let mut stmt = conn
                .prepare(
                    "SELECT geoname_id, name, ascii_name, latitude, longitude,
                            country_code, population, timezone
                     FROM cities WHERE geoname_id = ?",
                )
                .map_err(|e| anyhow!("{}", e))?;

            let mut rows = stmt
                .query_map(params![id], |row| {
                    Ok(crate::city::CityBasic {
                        geoname_id: row.get(0)?,
                        name: row.get(1)?,
                        ascii_name: row.get(2)?,
                        latitude: row.get(3)?,
                        longitude: row.get(4)?,
                        country_code: row.get(5)?,
                        population: row.get(6)?,
                        timezone: row.get(7)?,
                    })
                })
                .map_err(|e| anyhow!("{}", e))?;

            if let Some(Ok(city)) = rows.next() {
                cities.push(city);
            }
        }
        Ok(cities)
    }

    /// Aggregate statistics for the cities table.
    pub async fn get_stats(&self) -> Result<DbStats> {
        let conn = self.open()?;

        let total: usize = conn
            .query_row("SELECT COUNT(*) FROM cities", [], |r| r.get(0))
            .map_err(|e| anyhow!("{}", e))?;
        let with_country: usize = conn
            .query_row(
                "SELECT COUNT(*) FROM cities WHERE country_info IS NOT NULL",
                [],
                |r| r.get(0),
            )
            .map_err(|e| anyhow!("{}", e))?;
        let complete: usize = conn
            .query_row("SELECT COUNT(*) FROM cities WHERE is_valid = 1", [], |r| {
                r.get(0)
            })
            .map_err(|e| anyhow!("{}", e))?;

        Ok(DbStats {
            total,
            with_weather: 0,
            with_country,
            complete,
            incomplete: total - complete,
        })
    }

    /// Load all cities (basic info only) for POI collection.
    pub async fn get_all_cities_basic(&self) -> Result<Vec<crate::city::CityBasic>> {
        let conn = self.open()?;
        let mut stmt = conn
            .prepare(
                "SELECT geoname_id, name, ascii_name, latitude, longitude,
                        country_code, population, timezone
                 FROM cities ORDER BY geoname_id",
            )
            .map_err(|e| anyhow!("{}", e))?;

        let cities = stmt
            .query_map([], |row| {
                Ok(crate::city::CityBasic {
                    geoname_id: row.get(0)?,
                    name: row.get(1)?,
                    ascii_name: row.get(2)?,
                    latitude: row.get(3)?,
                    longitude: row.get(4)?,
                    country_code: row.get(5)?,
                    population: row.get(6)?,
                    timezone: row.get(7)?,
                })
            })
            .map_err(|e| anyhow!("{}", e))?
            .filter_map(|r| r.ok())
            .collect();

        Ok(cities)
    }

    /// Load city-level POI counts keyed by geoname_id.
    ///
    /// Used by Stage 4b to derive hex-level POI locally without additional
    /// Overpass requests.
    pub async fn get_city_poi_map(&self) -> Result<HashMap<i64, crate::poi::PoiCounts>> {
        let conn = self.open()?;
        let mut stmt = conn
            .prepare(
                "SELECT geoname_id, poi_data
                 FROM cities
                 WHERE poi_data IS NOT NULL",
            )
            .map_err(|e| anyhow!("{}", e))?;

        let mut out = HashMap::new();
        let rows = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, Option<String>>(1)?,
                ))
            })
            .map_err(|e| anyhow!("{}", e))?;

        for row in rows {
            let (geoname_id, poi_json) = match row {
                Ok(v) => v,
                Err(_) => continue,
            };
            let Some(poi_json) = poi_json else { continue };
            if let Ok(poi) = serde_json::from_str::<crate::poi::PoiCounts>(&poi_json) {
                out.insert(geoname_id, poi);
            }
        }

        Ok(out)
    }

    /// Cities that have not yet been assigned POI data (for resume support).
    pub async fn get_cities_without_poi(&self) -> Result<Vec<crate::city::CityBasic>> {
        let conn = self.open()?;
        let mut stmt = conn
            .prepare(
                "SELECT geoname_id, name, ascii_name, latitude, longitude,
                        country_code, population, timezone
                 FROM cities WHERE poi_data IS NULL ORDER BY geoname_id",
            )
            .map_err(|e| anyhow!("{}", e))?;

        let cities = stmt
            .query_map([], |row| {
                Ok(crate::city::CityBasic {
                    geoname_id: row.get(0)?,
                    name: row.get(1)?,
                    ascii_name: row.get(2)?,
                    latitude: row.get(3)?,
                    longitude: row.get(4)?,
                    country_code: row.get(5)?,
                    population: row.get(6)?,
                    timezone: row.get(7)?,
                })
            })
            .map_err(|e| anyhow!("{}", e))?
            .filter_map(|r| r.ok())
            .collect();

        Ok(cities)
    }

    /// Count of cities without POI data (lightweight — no row data returned).
    pub async fn count_cities_without_poi(&self) -> Result<usize> {
        let conn = self.open()?;
        let count: usize = conn
            .query_row(
                "SELECT COUNT(*) FROM cities WHERE poi_data IS NULL",
                [],
                |r| r.get(0),
            )
            .map_err(|e| anyhow!("{}", e))?;
        Ok(count)
    }

    /// Total number of cities in the database.
    pub async fn get_city_count(&self) -> Result<usize> {
        let conn = self.open()?;
        let count: usize = conn
            .query_row("SELECT COUNT(*) FROM cities", [], |r| r.get(0))
            .map_err(|e| anyhow!("{}", e))?;
        Ok(count)
    }

    // ── POI updates ──────────────────────────────────────────────────────

    /// Update POI data for a single city.
    pub async fn update_poi_climate(
        &self,
        geoname_id: i64,
        poi_data: Option<&crate::poi::PoiCounts>,
        _climate_data: Option<&()>,
        _climate_cell_id: Option<&str>,
        _climate_confidence: Option<f64>,
    ) -> Result<()> {
        let conn = self.open()?;
        let poi_json = poi_data.map(|p| serde_json::to_string(p).unwrap());

        conn.execute(
            "UPDATE cities SET poi_data = ? WHERE geoname_id = ?",
            params![poi_json, geoname_id],
        )
        .map_err(|e| anyhow!("update_poi failed: {}", e))?;

        Ok(())
    }

    /// Batch update POI rows in a single transaction.
    pub async fn update_poi_climate_batch(
        &self,
        rows: &[PoiClimateUpdate],
    ) -> Result<usize> {
        if rows.is_empty() {
            return Ok(0);
        }

        let conn = self.open()?;
        conn.execute_batch("BEGIN")
            .map_err(|e| anyhow!("BEGIN failed: {}", e))?;

        {
            let mut stmt = conn
                .prepare(
                    "UPDATE cities SET poi_data = ? WHERE geoname_id = ?",
                )
                .map_err(|e| anyhow!("prepare update_poi_batch: {}", e))?;

            for row in rows {
                let poi_json = row
                    .poi_data
                    .as_ref()
                    .map(serde_json::to_string)
                    .transpose()
                    .map_err(|e| anyhow!("poi JSON encode failed: {}", e))?;

                stmt.execute(params![poi_json, row.geoname_id])
                    .map_err(|e| {
                        anyhow!("batch row update failed ({}): {}", row.geoname_id, e)
                    })?;
            }
        }

        conn.execute_batch("COMMIT")
            .map_err(|e| anyhow!("COMMIT failed: {}", e))?;
        Ok(rows.len())
    }

    // ── VDB data loading ─────────────────────────────────────────────────

    /// Load all valid cities for vector computation.
    ///
    /// Only cities with `poi_data` present are returned.
    pub async fn load_all_cities_for_vdb(
        &self,
    ) -> Result<Vec<crate::normalizer::CityRawData>> {
        let conn = self.open()?;

        let total_valid: usize = conn
            .query_row(
                "SELECT COUNT(*) FROM cities WHERE is_valid = 1",
                [],
                |r| r.get(0),
            )
            .map_err(|e| anyhow!("{}", e))?;

        let complete: usize = conn
            .query_row(
                "SELECT COUNT(*) FROM cities WHERE is_valid = 1 AND poi_data IS NOT NULL",
                [],
                |r| r.get(0),
            )
            .map_err(|e| anyhow!("{}", e))?;

        let excluded = total_valid.saturating_sub(complete);
        if excluded > 0 {
            warn!(
                "⚠️  VDB data completeness: {}/{} cities have required data. {} excluded (incomplete — run collect-poi to fill gaps).",
                complete, total_valid, excluded
            );
        } else {
            info!(
                "✅ Data completeness: all {} valid cities have required data.",
                complete
            );
        }

        let mut stmt = conn.prepare(
            "SELECT geoname_id, name, ascii_name, country_code, latitude, longitude,
                    population, timezone, poi_data
             FROM cities
             WHERE is_valid = 1
               AND poi_data IS NOT NULL",
        )
        .map_err(|e| anyhow!("{}", e))?;

        let cities = stmt
            .query_map([], |row| {
                let poi_json: Option<String> = row.get(8)?;
                let poi = poi_json.and_then(|j| serde_json::from_str(&j).ok());

                Ok(crate::normalizer::CityRawData {
                    geoname_id: row.get(0)?,
                    name: row.get(1)?,
                    ascii_name: row.get(2)?,
                    country_code: row.get(3)?,
                    latitude: row.get(4)?,
                    longitude: row.get(5)?,
                    population: row.get(6)?,
                    timezone: row.get(7)?,
                    poi,
                })
            })
            .map_err(|e| anyhow!("{}", e))?
            .filter_map(|r| r.ok())
            .collect();

        Ok(cities)
    }

    // ── Export ────────────────────────────────────────────────────────────

    /// Export all cities to a pretty-printed JSON file.
    pub async fn export_to_json(&self, output_path: &Path) -> Result<()> {
        let conn = self.open()?;
        let mut stmt = conn
            .prepare(
                "SELECT geoname_id, name, ascii_name, latitude, longitude,
                        country_code, population, timezone, country_info, weather_info,
                        collected_at, is_valid
                 FROM cities ORDER BY geoname_id",
            )
            .map_err(|e| anyhow!("{}", e))?;

        let cities: Vec<serde_json::Value> = stmt
            .query_map([], |row| {
                Ok(serde_json::json!({
                    "geoname_id":  row.get::<_, i64>(0)?,
                    "name":        row.get::<_, String>(1)?,
                    "ascii_name":  row.get::<_, String>(2)?,
                    "latitude":    row.get::<_, f64>(3)?,
                    "longitude":   row.get::<_, f64>(4)?,
                    "country_code":row.get::<_, String>(5)?,
                    "population":  row.get::<_, i64>(6)?,
                    "timezone":    row.get::<_, String>(7)?,
                    "country_info":row.get::<_, Option<String>>(8)?,
                    "weather_info":row.get::<_, Option<String>>(9)?,
                    "collected_at":row.get::<_, String>(10)?,
                    "is_valid":    row.get::<_, i32>(11)? == 1,
                }))
            })
            .map_err(|e| anyhow!("{}", e))?
            .filter_map(|r| r.ok())
            .collect();

        let json = serde_json::to_string_pretty(&cities)?;
        tokio::fs::write(output_path, json).await?;

        info!("📤 Exported {} cities to {:?}", cities.len(), output_path);
        Ok(())
    }
}
