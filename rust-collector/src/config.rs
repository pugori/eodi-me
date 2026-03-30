use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use anyhow::{Result, Context};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Config {
    #[serde(default)]
    pub database: DatabaseConfig,

    #[serde(default)]
    pub collection: CollectionConfig,

    #[serde(default)]
    pub workers: WorkersConfig,

    #[serde(default)]
    pub rate_limiting: RateLimitingConfig,

    #[serde(default)]
    pub output: OutputConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DatabaseConfig {
    #[serde(default = "default_database_file")]
    pub file: PathBuf,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CollectionConfig {
    #[serde(default = "default_cities_file")]
    pub cities_file: PathBuf,

    #[serde(default)]
    pub limit: usize,

    #[serde(default = "default_true")]
    pub resume: bool,

    #[serde(default = "default_true")]
    pub validate: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkersConfig {
    #[serde(default = "default_min_workers")]
    pub min_workers: usize,

    #[serde(default = "default_max_workers")]
    pub max_workers: usize,

    #[serde(default = "default_worker_memory")]
    pub worker_memory_mb: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RateLimitingConfig {
    #[serde(default = "default_min_delay")]
    pub min_delay: f64,

    #[serde(default = "default_max_delay")]
    pub max_delay: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OutputConfig {
    #[serde(default = "default_output_directory")]
    pub directory: PathBuf,

    #[serde(default = "default_state_dir")]
    pub state_dir: PathBuf,
}

// Default values
fn default_database_file() -> PathBuf {
    PathBuf::from("cities.db")
}

fn default_cities_file() -> PathBuf {
    PathBuf::from("../cities15000.txt")
}

fn default_true() -> bool {
    true
}

fn default_min_workers() -> usize {
    2
}

fn default_max_workers() -> usize {
    16
}

fn default_worker_memory() -> u64 {
    200
}

fn default_min_delay() -> f64 {
    1.0
}

fn default_max_delay() -> f64 {
    60.0
}

fn default_output_directory() -> PathBuf {
    PathBuf::from("output")
}

fn default_state_dir() -> PathBuf {
    PathBuf::from("state")
}

impl Default for DatabaseConfig {
    fn default() -> Self {
        Self {
            file: default_database_file(),
        }
    }
}

impl Default for CollectionConfig {
    fn default() -> Self {
        Self {
            cities_file: default_cities_file(),
            limit: 0,
            resume: true,
            validate: true,
        }
    }
}

impl Default for WorkersConfig {
    fn default() -> Self {
        Self {
            min_workers: default_min_workers(),
            max_workers: default_max_workers(),
            worker_memory_mb: default_worker_memory(),
        }
    }
}

impl Default for RateLimitingConfig {
    fn default() -> Self {
        Self {
            min_delay: default_min_delay(),
            max_delay: default_max_delay(),
        }
    }
}

impl Default for OutputConfig {
    fn default() -> Self {
        Self {
            directory: default_output_directory(),
            state_dir: default_state_dir(),
        }
    }
}

impl Config {
    /// Load config from file, falling back to defaults if file doesn't exist
    pub fn load(path: Option<&std::path::Path>) -> Result<Self> {
        if let Some(config_path) = path {
            if config_path.exists() {
                let content = std::fs::read_to_string(config_path)
                    .context("Failed to read config file")?;
                let config: Config = toml::from_str(&content)
                    .context("Failed to parse config file")?;
                Ok(config)
            } else {
                tracing::warn!("Config file not found: {:?}, using defaults", config_path);
                Ok(Self::default())
            }
        } else {
            Ok(Self::default())
        }
    }

    /// Save config to file
    #[allow(dead_code)]
    pub fn save(&self, path: &PathBuf) -> Result<()> {
        let content = toml::to_string_pretty(self)
            .context("Failed to serialize config")?;
        std::fs::write(path, content)
            .context("Failed to write config file")?;
        Ok(())
    }
}
