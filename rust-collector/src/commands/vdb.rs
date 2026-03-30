//! Command handlers: `build-vdb` and `build-hex-vdb`.

use anyhow::Result;
use std::path::PathBuf;
use tracing::{info, warn};

use crate::commands::AppContext;
use crate::normalizer;
use crate::pipeline::vdb::build_city_vdb_from_db;
use crate::vectordb;

// ─────────────────────────────────────────────────────────────────────────────

pub async fn run_build_vdb(ctx: &AppContext, output: PathBuf) -> Result<()> {
    build_city_vdb_from_db(&ctx.db, &output, &ctx.database_path).await
}

// ─────────────────────────────────────────────────────────────────────────────

pub async fn run_build_hex_vdb(ctx: &AppContext, output: PathBuf) -> Result<()> {
    info!("🔐 Building Encrypted Hexagon Vector Database (.edbh)");
    info!("📂 Database: {:?}", ctx.database_path);
    info!("📤 Output: {:?}", output);

    let raw_hexes = ctx.db.load_valid_hexagons().await?;
    info!("✅ Loaded {} valid hexagons", raw_hexes.len());

    if raw_hexes.is_empty() {
        warn!("⚠️  No valid hexagons found. Run 'collect-hexagons' first.");
        return Ok(());
    }

    info!("📈 Pass 1: Computing global hexagon statistics...");
    let hex_stats = normalizer::GlobalHexStats::compute(&raw_hexes);
    info!("✅ Stats computed");

    info!("🧮 Pass 2: Computing 15D hex vectors (parallel)...");
    let hex_vectors = normalizer::compute_all_hex_vectors(&raw_hexes, &hex_stats);
    info!("✅ Computed {} vectors", hex_vectors.len());

    info!("🗄️  Building hex vector database...");
    let hex_vdb = vectordb::HexVectorDatabase::new(hex_vectors);

    info!("🔐 Encrypting and saving to {:?}...", output);
    hex_vdb.encrypt_to_file(&output)?;

    let file_size = std::fs::metadata(&output)?.len();
    info!(
        "✅ Hex VDB saved ({:.2} MB)",
        file_size as f64 / 1_048_576.0
    );

    info!("\n🎉 Hexagon VDB Build Complete!");
    info!("🔷 Total hexagons: {}", hex_vdb.hex_count);
    info!("🎯 Sigma²: {:.6}", hex_vdb.sigma_squared);
    info!("📦 FAISS index: {}", hex_vdb.faiss_index_type);
    info!("📦 Output: {:?}", output);
    Ok(())
}
