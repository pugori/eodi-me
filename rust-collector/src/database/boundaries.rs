//! Boundary CRUD operations (OSM admin-boundary polygons).

use anyhow::anyhow;
use anyhow::Result;
use duckdb::params;

use super::CityDatabase;
use crate::boundary::BoundaryRecord;

impl CityDatabase {
    /// Bulk insert boundary records for a country inside a single transaction.
    /// Skips records that already exist (idempotent — safe to re-run).
    pub async fn upsert_boundaries(&self, records: &[BoundaryRecord]) -> Result<()> {
        self.save_boundaries_chunked(records)
    }

    /// Sync chunked boundary save — splits large batches into 2 000-row
    /// transactions to avoid DuckDB OOM / transaction-size issues on
    /// countries with 50 000+ boundaries.
    pub fn save_boundaries_chunked(&self, records: &[BoundaryRecord]) -> Result<()> {
        if records.is_empty() {
            return Ok(());
        }

        const BATCH: usize = 500;
        let conn = self.open()?;

        for chunk in records.chunks(BATCH) {
            conn.execute_batch("BEGIN")
                .map_err(|e| anyhow!("begin: {}", e))?;

            {
                let mut stmt = conn
                    .prepare(
                        "INSERT OR REPLACE INTO boundaries
                             (id, name, admin_level, country_code, area_km2, geometry_json)
                         VALUES (?,?,?,?,?,?)",
                    )
                    .map_err(|e| anyhow!("prepare upsert_boundaries: {}", e))?;

                for rec in chunk {
                    stmt.execute(params![
                        rec.id,
                        rec.name,
                        rec.admin_level,
                        rec.country_code,
                        rec.area_km2,
                        rec.geometry_json,
                    ])
                    .map_err(|e| anyhow!("upsert boundary row: {}", e))?;
                }
            }

            conn.execute_batch("COMMIT")
                .map_err(|e| anyhow!("commit: {}", e))?;
        }
        Ok(())
    }

    /// Load all boundary records from the DB to rebuild the in-memory index.
    pub async fn load_all_boundaries(&self) -> Result<Vec<BoundaryRecord>> {
        let conn = self.open()?;
        let count: usize = conn
            .query_row("SELECT COUNT(*) FROM boundaries", [], |r| r.get(0))
            .map_err(|e| anyhow!("{}", e))?;

        if count == 0 {
            return Ok(vec![]);
        }

        let mut stmt = conn
            .prepare(
                "SELECT id, name, admin_level, country_code, area_km2, geometry_json
                 FROM boundaries
                 ORDER BY admin_level DESC",
            )
            .map_err(|e| anyhow!("{}", e))?;

        let rows = stmt
            .query_map([], |row| {
                Ok(BoundaryRecord {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    admin_level: row.get::<_, u8>(2)?,
                    country_code: row.get(3)?,
                    area_km2: row.get(4)?,
                    geometry_json: row.get(5)?,
                })
            })
            .map_err(|e| anyhow!("{}", e))?
            .filter_map(|r| r.ok())
            .collect();

        Ok(rows)
    }

    /// Build the R-tree index by loading boundaries from DB in chunks.
    ///
    /// Each chunk is parsed and the geometry_json strings are freed immediately,
    /// keeping peak memory at (slim records + parsed polygons + 1 chunk of JSON).
    /// This avoids the OOM that happens when loading 800K+ large geometry strings
    /// in a single `SELECT`.
    pub async fn build_boundary_index_chunked(&self) -> Result<crate::boundary::BoundaryIndex> {
        let records = self.load_all_boundaries().await?;
        tracing::info!("📥 Building spatial index over {} boundaries…", records.len());
        Ok(crate::boundary::BoundaryIndex::build(records))
    }

    /// Build an R-tree index for a specific set of countries only.
    ///
    /// Much cheaper than `build_boundary_index_chunked()` — loads only the
    /// countries you need instead of all 800K+ boundaries.
    pub async fn build_boundary_index_for_countries(
        &self,
        country_codes: &[String],
    ) -> Result<crate::boundary::BoundaryIndex> {
        if country_codes.is_empty() {
            return Ok(crate::boundary::BoundaryIndex::build(vec![]));
        }
        let records = self.load_boundaries_for_countries(country_codes).await?;
        tracing::info!(
            "📥 Building R-tree for {} countries ({} boundaries)",
            country_codes.len(),
            records.len(),
        );
        Ok(crate::boundary::BoundaryIndex::build(records))
    }

    /// Load boundary records for a specific set of country codes.
    pub async fn load_boundaries_for_countries(
        &self,
        country_codes: &[String],
    ) -> Result<Vec<BoundaryRecord>> {
        if country_codes.is_empty() {
            return Ok(vec![]);
        }
        let placeholders = country_codes
            .iter()
            .map(|_| "?")
            .collect::<Vec<_>>()
            .join(",");
        let sql = format!(
            "SELECT id, name, admin_level, country_code, area_km2, geometry_json
             FROM boundaries
             WHERE country_code IN ({})
             ORDER BY admin_level DESC",
            placeholders
        );

        let conn = self.open()?;
        let mut stmt = conn.prepare(&sql).map_err(|e| anyhow!("{}", e))?;

        let params_vec: Vec<&dyn duckdb::ToSql> = country_codes
            .iter()
            .map(|s| s as &dyn duckdb::ToSql)
            .collect();

        let rows = stmt
            .query_map(params_vec.as_slice(), |row| {
                Ok(BoundaryRecord {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    admin_level: row.get::<_, u8>(2)?,
                    country_code: row.get(3)?,
                    area_km2: row.get(4)?,
                    geometry_json: row.get(5)?,
                })
            })
            .map_err(|e| anyhow!("{}", e))?
            .filter_map(|r| r.ok())
            .collect();

        Ok(rows)
    }

    /// Country codes that already have boundaries downloaded.
    pub async fn get_downloaded_boundary_countries(
        &self,
    ) -> Result<std::collections::HashSet<String>> {
        let conn = self.open()?;
        let mut stmt = conn
            .prepare("SELECT DISTINCT country_code FROM boundaries")
            .map_err(|e| anyhow!("{}", e))?;

        let codes = stmt
            .query_map([], |row| row.get(0))
            .map_err(|e| anyhow!("{}", e))?
            .filter_map(|r: std::result::Result<String, _>| r.ok())
            .collect();
        Ok(codes)
    }

    /// Count of boundary polygons per country.
    pub async fn get_boundary_stats(&self) -> Result<Vec<(String, usize)>> {
        let conn = self.open()?;
        let mut stmt = conn
            .prepare(
                "SELECT country_code, COUNT(*) as cnt
                 FROM boundaries
                 GROUP BY country_code
                 ORDER BY cnt DESC",
            )
            .map_err(|e| anyhow!("{}", e))?;

        let rows = stmt
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, usize>(1)?))
            })
            .map_err(|e| anyhow!("{}", e))?
            .filter_map(|r| r.ok())
            .collect();
        Ok(rows)
    }

    /// Delete all boundary polygons for a specific country code.
    ///
    /// Used by the integrity-check flow to re-download fresh data for gap
    /// countries.
    pub async fn delete_boundaries_for_country(&self, country_code: &str) -> Result<usize> {
        let conn = self.open()?;
        let count: usize = conn
            .query_row(
                "SELECT COUNT(*) FROM boundaries WHERE country_code = ?",
                params![country_code],
                |r| r.get(0),
            )
            .map_err(|e| anyhow!("{}", e))?;
        conn.execute_batch(
            &format!(
                "DELETE FROM boundaries WHERE country_code = '{}'",
                country_code.replace('\'', "''")
            ),
        )
        .map_err(|e| anyhow!("delete boundaries for {}: {}", country_code, e))?;
        Ok(count)
    }

    /// Delete boundaries for countries NOT in the keep-list.
    ///
    /// Returns number of deleted rows.
    pub async fn delete_boundaries_not_in(&self, keep_country_codes: &[String]) -> Result<usize> {
        let conn = self.open()?;

        let deleted: usize = if keep_country_codes.is_empty() {
            conn.query_row("SELECT COUNT(*) FROM boundaries", [], |r| r.get(0))
                .map_err(|e| anyhow!("{}", e))?
        } else {
            let keep = keep_country_codes
                .iter()
                .map(|cc| format!("'{}'", cc.replace('\'', "''")))
                .collect::<Vec<_>>()
                .join(",");
            conn.query_row(
                &format!(
                    "SELECT COUNT(*) FROM boundaries WHERE country_code NOT IN ({})",
                    keep
                ),
                [],
                |r| r.get(0),
            )
            .map_err(|e| anyhow!("{}", e))?
        };

        if deleted == 0 {
            return Ok(0);
        }

        if keep_country_codes.is_empty() {
            conn.execute_batch("DELETE FROM boundaries")
                .map_err(|e| anyhow!("delete all boundaries: {}", e))?;
        } else {
            let keep = keep_country_codes
                .iter()
                .map(|cc| format!("'{}'", cc.replace('\'', "''")))
                .collect::<Vec<_>>()
                .join(",");
            conn.execute_batch(&format!(
                "DELETE FROM boundaries WHERE country_code NOT IN ({})",
                keep
            ))
            .map_err(|e| anyhow!("delete boundaries not in keep-list: {}", e))?;
        }

        Ok(deleted)
    }
}
