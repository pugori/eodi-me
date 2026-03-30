//! CLI definition — `Cli` struct and `Commands` enum.
//!
//! All `clap` derives live here.  `main.rs` stays free of CLI boilerplate.

use clap::{Parser, Subcommand};
use std::path::PathBuf;

#[derive(Parser)]
#[command(name = "eodi-collector")]
#[command(about = "City Vibe Engine — Data Collector\n\nRun without arguments for automatic full pipeline.")]
pub struct Cli {
    /// Config file path (optional, uses defaults if not provided)
    #[arg(short = 'c', long)]
    pub config: Option<PathBuf>,

    /// Output directory (overrides config)
    #[arg(short, long)]
    pub output: Option<PathBuf>,

    /// Database file (overrides config)
    #[arg(long)]
    pub database: Option<PathBuf>,

    /// State directory for resume (overrides config)
    #[arg(long)]
    pub state_dir: Option<PathBuf>,

    /// Do not wait for Enter before exiting
    #[arg(long, default_value_t = false)]
    pub no_pause: bool,

    #[command(subcommand)]
    pub command: Option<Commands>,
}

#[derive(Subcommand, Debug)]
pub enum Commands {
    /// Parse cities15000.txt and collect Stage-1 data (country metadata)
    CollectCities {
        /// Path to cities15000.txt (overrides config)
        #[arg(short = 'f', long)]
        cities_file: Option<PathBuf>,
        /// Maximum cities to process (0 = all, overrides config)
        #[arg(short, long)]
        limit: Option<usize>,
        /// Resume from previous run
        #[arg(long)]
        resume: Option<bool>,
        /// Validate and re-fetch if data is corrupted
        #[arg(long)]
        validate: Option<bool>,
        /// Minimum concurrent workers
        #[arg(long)]
        min_workers: Option<usize>,
        /// Maximum concurrent workers
        #[arg(long)]
        max_workers: Option<usize>,
        /// Memory per worker in MB
        #[arg(long)]
        worker_memory_mb: Option<u64>,
    },

    /// Show collection statistics
    Stats,

    /// Validate database integrity
    Validate,

    /// Re-collect missing or corrupted data
    Repair {
        /// Force re-fetch all
        #[arg(long)]
        force: bool,
    },

    /// Export to JSON
    Export {
        /// Output file
        #[arg(short, long)]
        output: Option<PathBuf>,
    },

    /// Collect POI data (Stage 2) via Geofabrik PBF
    CollectPoi {
        /// Maximum cities to process (0 = all)
        #[arg(short, long, default_value = "0")]
        limit: usize,
        /// Overpass API endpoint
        #[arg(long, default_value = "https://overpass-api.de/api/interpreter")]
        overpass_api: String,
        /// Concurrency level (3–10)
        #[arg(long, default_value = "6")]
        concurrency: usize,
    },

    /// Build encrypted 13D city vector database (.edb)
    BuildVdb {
        /// Output .edb file path
        #[arg(short, long, default_value = "cities.edb")]
        output: PathBuf,
    },

    /// Full pipeline: cities → POI → encrypted VDB → hexagons → hex VDB
    BuildFull {
        /// Path to cities15000.txt
        #[arg(short = 'f', long)]
        cities_file: PathBuf,
        /// Maximum cities to process (0 = all)
        #[arg(short, long, default_value = "0")]
        limit: usize,
        /// Output .edb file path
        #[arg(short, long, default_value = "cities.edb")]
        output: PathBuf,
        /// POI collection concurrency (3–10)
        #[arg(long, default_value = "6")]
        poi_concurrency: usize,
        /// Skip Stage 1 (cities already collected)
        #[arg(long)]
        skip_cities: bool,
        /// Skip Stage 2 (POI already collected)
        #[arg(long)]
        skip_poi: bool,
        /// Skip Stages 4/4b/5 (hexagon pipeline)
        #[arg(long)]
        skip_hexagons: bool,
        /// Batch size for streaming processing
        #[arg(long, default_value = "500")]
        batch_size: usize,
        /// Overpass API endpoint
        #[arg(long, default_value = "https://overpass-api.de/api/interpreter")]
        overpass_api: String,
    },

    /// Download OSM admin-boundary polygons per country (run once before hexagons)
    DownloadBoundaries {
        /// Overpass API endpoint
        #[arg(long, default_value = "https://overpass-api.de/api/interpreter")]
        overpass_api: String,
        /// Resume: skip already-downloaded countries
        #[arg(long, default_value_t = true)]
        resume: bool,
        /// Comma-separated country codes to limit (empty = all)
        #[arg(long, default_value = "")]
        countries: String,
    },

    /// Collect H3 Res-8 hexagons with local Max Areal Overlap boundary assignment
    CollectHexagons {
        /// Maximum cities to process (0 = all)
        #[arg(short, long, default_value = "0")]
        limit: usize,
        /// Overpass API endpoint
        #[arg(long, default_value = "https://overpass-api.de/api/interpreter")]
        overpass_api: String,
        /// Concurrency (6–10 is safe with local boundary index)
        #[arg(long, default_value = "8")]
        concurrency: usize,
        /// Resume: skip cities whose hexagons are already collected
        #[arg(long, default_value_t = true)]
        resume: bool,
    },

    /// Build encrypted 13D hexagon vector database (.edbh)
    BuildHexVdb {
        /// Output .edbh file path
        #[arg(short, long, default_value = "hexagons.edbh")]
        output: PathBuf,
    },

    /// Export valid hexagons to Parquet (ZSTD) for downstream ML
    ExportHexagons {
        /// Output Parquet file path
        #[arg(short, long, default_value = "hexagons.parquet")]
        output: PathBuf,
    },
    /// Create a default config file and initialize output/state directories
    Init {
        /// Path to write config file (default: config.toml)
        #[arg(short, long)]
        config: Option<PathBuf>,
    },
}
