//! Table creation and schema migrations.

use anyhow::{anyhow, Result};
use tracing::info;

use super::CityDatabase;

impl CityDatabase {
    /// Initialise all tables and run idempotent migrations.
    pub async fn init(&self) -> Result<()> {
        let conn = self.open()?;

        // ── Cities table ─────────────────────────────────────────────────
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS cities (
                geoname_id   BIGINT  PRIMARY KEY,
                name         VARCHAR NOT NULL,
                ascii_name   VARCHAR NOT NULL,
                latitude     DOUBLE  NOT NULL,
                longitude    DOUBLE  NOT NULL,
                country_code VARCHAR NOT NULL,
                population   BIGINT  NOT NULL,
                timezone     VARCHAR NOT NULL,
                country_info VARCHAR,
                weather_info VARCHAR,
                poi_data     VARCHAR,
                collected_at VARCHAR NOT NULL,
                is_valid     INTEGER DEFAULT 0,
                created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            CREATE INDEX IF NOT EXISTS idx_country_code ON cities(country_code);
            CREATE INDEX IF NOT EXISTS idx_is_valid ON cities(is_valid);",
        )
        .map_err(|e| anyhow!("cities table init failed: {}", e))?;

        // ── Hexagons table ───────────────────────────────────────────────
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS hexagons (
                h3_index         UBIGINT  PRIMARY KEY,
                lat              DOUBLE   NOT NULL,
                lon              DOUBLE   NOT NULL,
                admin_name       VARCHAR  NOT NULL,
                admin_level      UTINYINT NOT NULL DEFAULT 0,
                overlap_ratio    DOUBLE   DEFAULT 0.0,
                parent_city_id   BIGINT   NOT NULL,
                parent_city_name VARCHAR  NOT NULL,
                poi_data         VARCHAR,
                is_valid         BOOLEAN  NOT NULL DEFAULT false,
                created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            CREATE INDEX IF NOT EXISTS idx_hex_parent ON hexagons(parent_city_id);
            CREATE INDEX IF NOT EXISTS idx_hex_admin  ON hexagons(admin_name);
            CREATE INDEX IF NOT EXISTS idx_hex_valid  ON hexagons(is_valid);",
        )
        .map_err(|e| anyhow!("hexagons table init failed: {}", e))?;

        // ── Boundaries table ─────────────────────────────────────────────
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS boundaries (
                id              BIGINT   PRIMARY KEY,
                name            VARCHAR  NOT NULL,
                admin_level     UTINYINT NOT NULL,
                country_code    VARCHAR  NOT NULL,
                area_km2        DOUBLE   NOT NULL DEFAULT 0.0,
                geometry_json   VARCHAR  NOT NULL,
                created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            CREATE INDEX IF NOT EXISTS idx_boundary_country ON boundaries(country_code);
            CREATE INDEX IF NOT EXISTS idx_boundary_level   ON boundaries(admin_level);",
        )
        .map_err(|e| anyhow!("boundaries table init failed: {}", e))?;

        info!("✅ DuckDB database initialized: {:?}", self.path);

        self.migrate(&conn)?;
        Ok(())
    }

    /// Apply incremental schema changes to existing databases.
    ///
    /// All migrations are idempotent — safe to run on every startup.
    fn migrate(&self, conn: &duckdb::Connection) -> Result<()> {
        // v0 → v1: cities table gained poi_data column
        if !self.column_exists(conn, "cities", "poi_data")? {
            conn.execute_batch("ALTER TABLE cities ADD COLUMN poi_data VARCHAR;")
                .map_err(|e| anyhow!("migration: add cities.poi_data: {}", e))?;
            info!("🔧 DB migration: added cities.poi_data");
        }

        // v1 → v2: hexagons table gained overlap_ratio column
        if !self.column_exists(conn, "hexagons", "overlap_ratio")? {
            conn.execute_batch(
                "ALTER TABLE hexagons ADD COLUMN overlap_ratio DOUBLE DEFAULT 0.0;",
            )
            .map_err(|e| anyhow!("migration: add overlap_ratio: {}", e))?;
            info!("🔧 DB migration: added hexagons.overlap_ratio");
        }

        // v2 → v3: boundaries table
        if !self.table_exists(conn, "boundaries")? {
            conn.execute_batch(
                "CREATE TABLE IF NOT EXISTS boundaries (
                    id              BIGINT   PRIMARY KEY,
                    name            VARCHAR  NOT NULL,
                    admin_level     UTINYINT NOT NULL,
                    country_code    VARCHAR  NOT NULL,
                    area_km2        DOUBLE   NOT NULL DEFAULT 0.0,
                    geometry_json   VARCHAR  NOT NULL,
                    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
                CREATE INDEX IF NOT EXISTS idx_boundary_country ON boundaries(country_code);
                CREATE INDEX IF NOT EXISTS idx_boundary_level   ON boundaries(admin_level);",
            )
            .map_err(|e| anyhow!("migration: create boundaries table: {}", e))?;
            info!("🔧 DB migration: created boundaries table");
        }

        Ok(())
    }

    // ── Migration helpers ────────────────────────────────────────────────

    fn column_exists(
        &self,
        conn: &duckdb::Connection,
        table: &str,
        column: &str,
    ) -> Result<bool> {
        let exists: bool = conn
            .query_row(
                "SELECT COUNT(*) > 0 FROM information_schema.columns
                 WHERE table_name = ? AND column_name = ?",
                duckdb::params![table, column],
                |r| r.get(0),
            )
            .unwrap_or(false);
        Ok(exists)
    }

    fn table_exists(&self, conn: &duckdb::Connection, table: &str) -> Result<bool> {
        let exists: bool = conn
            .query_row(
                "SELECT COUNT(*) > 0 FROM information_schema.tables
                 WHERE table_name = ?",
                duckdb::params![table],
                |r| r.get(0),
            )
            .unwrap_or(false);
        Ok(exists)
    }
}
