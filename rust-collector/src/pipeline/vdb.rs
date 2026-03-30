//! Pipeline helper — build the encrypted city vector database from collected DB rows.

use anyhow::Result;
use tracing::{info, warn};

use crate::database::CityDatabase;
use crate::normalizer;
use crate::vectordb;

/// Load all complete city rows from `db`, compute 15-D vectors, encrypt and
/// write to `output`.  Returns immediately (with a warning) when no rows
/// qualify.
pub async fn build_city_vdb_from_db(
    db: &CityDatabase,
    output: &std::path::Path,
    database_path: &std::path::Path,
) -> Result<()> {
    info!("🔐 Building Encrypted 15D Vector Database");
    info!("📂 Database: {:?}", database_path);
    info!("📤 Output: {:?}", output);

    info!("📊 Loading cities from database...");
    let raw_cities = db.load_all_cities_for_vdb().await?;
    info!("✅ Loaded {} cities with POI data", raw_cities.len());

    if raw_cities.is_empty() {
        warn!("⚠️  No cities with POI data found. Run 'collect-poi' first.");
        return Ok(());
    }

    info!("📈 Pass 1: Computing global statistics...");
    let global_stats = normalizer::GlobalStats::compute(&raw_cities);
    info!("✅ Global stats computed");

    info!("🧮 Pass 2: Computing 15D vectors (parallel)...");
    let city_vectors = normalizer::compute_all_vectors(&raw_cities, &global_stats);
    info!("✅ Computed {} vectors", city_vectors.len());

    info!("🗄️  Building vector database...");
    let vdb = vectordb::VectorDatabase::new(city_vectors);

    if let Err(e) = vdb.validate() {
        return Err(anyhow::anyhow!("Vector database validation failed: {}", e));
    }
    info!("✅ Validation passed (all values in [0,1], no NaN/Inf)");

    info!("🔐 Encrypting and saving to {:?}...", output);
    vdb.encrypt_to_file(output)?;

    let file_size = std::fs::metadata(output)?.len();
    info!(
        "✅ Encrypted database saved ({:.2} MB)",
        file_size as f64 / 1_048_576.0
    );

    info!("\n🎉 Vector Database Build Complete!");
    info!("📊 Schema Version: {}", vdb.schema_version);
    info!("🌍 Total Cities: {}", vdb.cities.len());
    info!("🎯 Sigma²: {:.6}", vdb.sigma_squared);
    info!("📄 Data Sources:");
    for source in &vdb.data_sources {
        info!("  - {}: {} ({})", source.name, source.url, source.license);
    }

    Ok(())
}
