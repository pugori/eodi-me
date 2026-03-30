//! Command dispatch — `AppContext` and the `dispatch` entry point.
//!
//! Each `Commands` variant is handled by a dedicated sub-module.  `dispatch`
//! routes the parsed CLI command to the right handler, passing `AppContext`
//! instead of raw path arguments so handlers stay free of repetition.

pub mod build_full;
pub mod collect_cities;
pub mod collect_hexagons;
pub mod collect_poi;
pub mod download_boundaries;
pub mod misc;
pub mod init;
pub mod vdb;

use anyhow::Result;
use std::path::PathBuf;

use crate::cli::Commands;
use crate::config::Config;
use crate::database::CityDatabase;

// ─────────────────────────────────────────────────────────────────────────────

/// Everything a command handler needs: DB handle, paths, config.
pub struct AppContext {
    pub db: CityDatabase,
    pub database_path: PathBuf,
    pub output_path: PathBuf,
    pub config: Config,
}

// ─────────────────────────────────────────────────────────────────────────────

/// Route `command` to the appropriate handler.
pub async fn dispatch(command: Commands, ctx: &AppContext) -> Result<()> {
    match command {
        // ── collect-cities ──────────────────────────────────────────────────
        Commands::CollectCities {
            cities_file,
            limit,
            resume,
            validate,
            min_workers: _,
            max_workers: _,
            worker_memory_mb: _,
        } => {
            collect_cities::run(
                ctx,
                collect_cities::CollectCitiesArgs {
                    cities_file: cities_file
                        .unwrap_or_else(|| ctx.config.collection.cities_file.clone()),
                    limit: limit.unwrap_or(ctx.config.collection.limit),
                    resume: resume.unwrap_or(ctx.config.collection.resume),
                    validate: validate.unwrap_or(ctx.config.collection.validate),
                },
            )
            .await
        }

        // ── stats ───────────────────────────────────────────────────────────
        Commands::Stats => misc::run_stats(ctx).await,

        // ── validate ────────────────────────────────────────────────────────
        Commands::Validate => misc::run_validate(ctx).await,

        // ── repair ──────────────────────────────────────────────────────────
        Commands::Repair { force } => misc::run_repair(ctx, force).await,

        // ── export ──────────────────────────────────────────────────────────
        Commands::Export { output } => misc::run_export(ctx, output).await,

        // ── collect-poi ─────────────────────────────────────────────────────
        Commands::CollectPoi {
            limit,
            overpass_api: _,
            concurrency,
        } => {
            collect_poi::run(
                ctx,
                collect_poi::CollectPoiArgs {
                    limit,
                    concurrency,
                },
            )
            .await
        }

        // ── build-vdb ───────────────────────────────────────────────────────
        Commands::BuildVdb { output } => vdb::run_build_vdb(ctx, output).await,

        // ── build-full ──────────────────────────────────────────────────────
        Commands::BuildFull {
            cities_file,
            limit,
            output,
            poi_concurrency,
            skip_cities,
            skip_poi,
            skip_hexagons,
            batch_size: _,
            overpass_api,
        } => {
            build_full::run(
                ctx,
                build_full::BuildFullArgs {
                    cities_file,
                    limit,
                    output,
                    poi_concurrency,
                    batch_size: 500,
                    skip_cities,
                    skip_poi,
                    skip_hexagons,
                    overpass_api,
                },
            )
            .await
        }

        // ── download-boundaries ─────────────────────────────────────────────
        Commands::DownloadBoundaries {
            overpass_api,
            resume,
            countries,
        } => {
            download_boundaries::run(
                ctx,
                download_boundaries::DownloadBoundariesArgs {
                    overpass_api,
                    resume,
                    countries,
                },
            )
            .await
        }

        // ── collect-hexagons ────────────────────────────────────────────────
        Commands::CollectHexagons {
            limit,
            overpass_api,
            concurrency,
            resume,
        } => {
            collect_hexagons::run(
                ctx,
                collect_hexagons::CollectHexagonsArgs {
                    limit,
                    overpass_api,
                    concurrency,
                    resume,
                },
            )
            .await
        }

        // ── build-hex-vdb ───────────────────────────────────────────────────
        Commands::BuildHexVdb { output } => vdb::run_build_hex_vdb(ctx, output).await,

        // ── export-hexagons ─────────────────────────────────────────────────
        Commands::ExportHexagons { output } => misc::run_export_hexagons(ctx, output).await,
        // ── init ─────────────────────────────────────────────────────────────
        Commands::Init { config } => init::run(ctx, config).await,
    }
}
