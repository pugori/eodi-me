//! Database maintenance helpers (size control / compaction).

use anyhow::{anyhow, Result};
use tracing::info;

use super::CityDatabase;

impl CityDatabase {
    /// Current DB file size in bytes.
    pub async fn db_file_size_bytes(&self) -> Result<u64> {
        let md = std::fs::metadata(&self.path)
            .map_err(|e| anyhow!("db metadata failed: {}", e))?;
        Ok(md.len())
    }

    /// Run DuckDB maintenance to reclaim free pages after heavy DELETE/REPLACE.
    pub async fn compact_database_file(&self) -> Result<()> {
        let conn = self.open()?;
        info!("🧹 Running DuckDB CHECKPOINT + VACUUM for file compaction...");
        conn.execute_batch("CHECKPOINT;")
            .map_err(|e| anyhow!("checkpoint failed: {}", e))?;
        conn.execute_batch("VACUUM;")
            .map_err(|e| anyhow!("vacuum failed: {}", e))?;
        Ok(())
    }
}
