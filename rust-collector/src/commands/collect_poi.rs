//! Command handler: `collect-poi`
//!
//! Stage 2 — POI data via Geofabrik PBF.

use anyhow::Result;
use tracing::info;

use crate::commands::AppContext;
use crate::stages;

pub struct CollectPoiArgs {
    pub limit: usize,
    pub concurrency: usize,
}

pub async fn run(ctx: &AppContext, args: CollectPoiArgs) -> Result<()> {
    info!("🌍 POI Data Collection Started (PBF mode)");
    info!("📂 Database: {:?}", ctx.database_path);

    stages::execute_stage_poi(
        &ctx.db,
        args.limit,
        false, // skip_poi
        args.concurrency,
        &ctx.database_path,
    )
    .await?;

    Ok(())
}
