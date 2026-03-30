//! Initialize project configuration and output/state directories.

use anyhow::Result;
use std::path::PathBuf;
use tracing::info;

use crate::commands::AppContext;
use crate::config::Config;

pub async fn run(_ctx: &AppContext, config: Option<PathBuf>) -> Result<()> {
    let config_path = config.unwrap_or_else(|| PathBuf::from("config.toml"));

    let default_cfg = Config::default();
    info!("🛠️  Writing default config to {:?}", config_path);
    default_cfg.save(&config_path)?;

    // Ensure output and state directories exist
    let out_dir = default_cfg.output.directory.clone();
    let state_dir = default_cfg.output.state_dir.clone();
    if !out_dir.exists() {
        std::fs::create_dir_all(&out_dir)?;
        info!("Created output directory: {:?}", out_dir);
    } else {
        info!("Output directory already exists: {:?}", out_dir);
    }
    if !state_dir.exists() {
        std::fs::create_dir_all(&state_dir)?;
        info!("Created state directory: {:?}", state_dir);
    } else {
        info!("State directory already exists: {:?}", state_dir);
    }

    info!("✅ Init complete. You can edit {:?} and re-run the collector.", config_path);
    Ok(())
}
