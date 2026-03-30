//! **eodi-collector** — High-performance geospatial data collector for the
//! City Vibe Engine.
//!
//! # Architecture
//!
//! The collector runs a 5-stage pipeline:
//!
//! | Stage | Module             | Description                                   |
//! |-------|--------------------|-----------------------------------------------|
//! | 1     | `commands::collect_cities` | Parse GeoNames TSV, fetch country info |
//! | 2/3   | `stages`           | PBF POI extraction                            |
//! | 4a    | `commands::download_boundaries` | OSM admin-boundary polygons       |
//! | 4b    | `commands::collect_hexagons`    | H3 hexagonal grid + POI query     |
//! | 5     | `commands::vdb`    | Encrypted vector database build                |
//!
//! # Key design decisions
//!
//! - **DuckDB** over SQLite for columnar storage at hexagon scale (5–10M rows).
//! - **Domain-level rate limiting** via slot-reservation (`ratelimit`).
//! - **AES-256-GCM** encryption for the `.edb` vector database format.
//! - **mimalloc** global allocator for reduced contention under heavy parallelism.

pub mod adaptive;
pub mod boundary;
pub mod city;
pub mod cli;
pub mod collector;
pub mod commands;
pub mod config;
pub mod database;
pub mod hexagon;
pub mod metrics;
pub mod normalizer;
pub mod pbf;
pub mod pipeline;
pub mod poi;
pub mod ratelimit;
pub mod resources;
pub mod stages;
pub mod vectordb;

use anyhow::Result;
use std::path::Path;

/// Run the collector with the parsed CLI arguments.
///
/// This is the single top-level entry point called by `main`.  It handles:
/// 1. Configuration loading (TOML file or defaults)
/// 2. Runtime directory creation
/// 3. Database initialisation / migration
/// 4. Auto-detection or explicit command dispatch
pub async fn run(cli: cli::Cli) -> Result<()> {
    use config::Config;
    use database::CityDatabase;

    let no_pause = cli.no_pause;

    let run_result: Result<()> = async {
        let mut config = Config::load(cli.config.as_deref())?;

        if let Some(state_dir) = cli.state_dir {
            config.output.state_dir = state_dir;
        }

        let database_path = cli.database.unwrap_or_else(|| config.database.file.clone());
        let output_path = cli.output.unwrap_or_else(|| config.output.directory.clone());

        ensure_runtime_dirs(&database_path, &output_path, &config.output.state_dir)?;

        let db = CityDatabase::new(&database_path).await?;
        db.init().await?;

        let command = match cli.command {
            Some(cmd) => cmd,
            None => pipeline::auto::run_auto_pipeline(&database_path, &output_path).await?,
        };

        let ctx = commands::AppContext {
            db,
            database_path,
            output_path,
            config,
        };
        commands::dispatch(command, &ctx).await
    }
    .await;

    maybe_pause_before_exit(no_pause, run_result.is_ok());
    run_result
}

/// Create directories required at runtime (database parent, output, state).
fn ensure_runtime_dirs(database_path: &Path, output_path: &Path, state_path: &Path) -> Result<()> {
    if let Some(parent) = database_path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::create_dir_all(output_path)?;
    std::fs::create_dir_all(state_path)?;
    Ok(())
}

/// Optionally pause before exit so users can read terminal output.
///
/// Skipped when `--no-pause` is passed or `EODI_NO_PAUSE=1` is set.
fn maybe_pause_before_exit(no_pause: bool, success: bool) {
    use std::io::Write;

    if no_pause {
        return;
    }
    if std::env::var("EODI_NO_PAUSE").ok().as_deref() == Some("1") {
        return;
    }

    if success {
        println!("\n✅ 작업이 성공적으로 완료되었습니다. Enter 키를 누르면 종료됩니다...");
    } else {
        println!("\n❌ 작업이 실패하여 중단되었습니다. 로그를 확인한 뒤 Enter 키를 누르면 종료됩니다...");
    }
    let _ = std::io::stdout().flush();
    let mut line = String::new();
    let _ = std::io::stdin().read_line(&mut line);
}
