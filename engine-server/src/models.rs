//! Shared data models for the engine server.
//!
//! These structs must match the `bincode` schema written by
//! `rust-collector/src/vectordb.rs` exactly.
//!
//! Maintains backward compatibility with legacy `.edbh` files that lack
//! `poi_counts` by providing `LegacyHexVector` as a fallback.

use serde::{Deserialize, Serialize};

/// Data source attribution (license compliance).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DataSource {
    pub name: String,
    pub license: String,
    pub url: String,
}

/// A single hexagon's computed feature vector and metadata.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HexVector {
    pub h3_index: u64,
    pub lat: f32,
    pub lon: f32,
    pub admin_name: String,
    pub admin_level: u8,
    #[serde(default)]
    pub country_code: String,
    pub parent_city_id: i64,
    pub parent_city_name: String,
    /// 13-dimensional Urban Vibe feature vector, all values in [0.0, 1.0].
    pub vector: [f32; 13],
    /// Raw POI category counts: [vitality, culture, relief, rhythm, lifestyle, commercial, total].
    /// Used for dynamic 6-axis vibe computation (enables user data merging).
    #[serde(default)]
    pub poi_counts: [u32; 7],
}

/// The top-level database container serialized/encrypted in `.edbh` files.
#[derive(Debug, Serialize, Deserialize)]
pub struct HexVectorDatabase {
    pub schema_version: u8,
    pub spec_version: String,
    pub built_at: String,
    pub hex_count: u32,
    pub sigma_squared: f64,
    pub faiss_index_type: String,
    pub data_sources: Vec<DataSource>,
    pub hexagons: Vec<HexVector>,
}

// ─────────────────────────────────────────────────────────────────────────────
// Legacy structs — backward compatibility with older .edbh files
// ─────────────────────────────────────────────────────────────────────────────

/// Legacy HexVector WITH country_code but WITHOUT poi_counts (hypothetical format).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LegacyHexVector {
    pub h3_index: u64,
    pub lat: f32,
    pub lon: f32,
    pub admin_name: String,
    pub admin_level: u8,
    pub country_code: String,
    pub parent_city_id: i64,
    pub parent_city_name: String,
    pub vector: [f32; 13],
}

/// Legacy database container with country_code, without poi_counts.
#[derive(Debug, Serialize, Deserialize)]
pub struct LegacyHexVectorDatabase {
    pub schema_version: u8,
    pub spec_version: String,
    pub built_at: String,
    pub hex_count: u32,
    pub sigma_squared: f64,
    pub faiss_index_type: String,
    pub data_sources: Vec<DataSource>,
    pub hexagons: Vec<LegacyHexVector>,
}

impl LegacyHexVectorDatabase {
    pub fn into_current(self) -> HexVectorDatabase {
        HexVectorDatabase {
            schema_version: self.schema_version,
            spec_version: self.spec_version,
            built_at: self.built_at,
            hex_count: self.hex_count,
            sigma_squared: self.sigma_squared,
            faiss_index_type: self.faiss_index_type,
            data_sources: self.data_sources,
            hexagons: self
                .hexagons
                .into_iter()
                .map(|h| HexVector {
                    h3_index: h.h3_index,
                    lat: h.lat,
                    lon: h.lon,
                    admin_name: h.admin_name,
                    admin_level: h.admin_level,
                    country_code: h.country_code,
                    parent_city_id: h.parent_city_id,
                    parent_city_name: h.parent_city_name,
                    vector: h.vector,
                    poi_counts: [0; 7],
                })
                .collect(),
        }
    }
}

/// Original HexVector format as written by rust-collector: no country_code, no poi_counts.
/// This is the format of all existing .edbh files built before country_code was added.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OriginalHexVector {
    pub h3_index: u64,
    pub lat: f32,
    pub lon: f32,
    pub admin_name: String,
    pub admin_level: u8,
    pub parent_city_id: i64,
    pub parent_city_name: String,
    pub vector: [f32; 13],
}

/// Original database container (matches rust-collector output exactly).
#[derive(Debug, Serialize, Deserialize)]
pub struct OriginalHexVectorDatabase {
    pub schema_version: u8,
    pub spec_version: String,
    pub built_at: String,
    pub hex_count: u32,
    pub sigma_squared: f64,
    pub faiss_index_type: String,
    pub data_sources: Vec<DataSource>,
    pub hexagons: Vec<OriginalHexVector>,
}

impl OriginalHexVectorDatabase {
    pub fn into_current(self) -> HexVectorDatabase {
        HexVectorDatabase {
            schema_version: self.schema_version,
            spec_version: self.spec_version,
            built_at: self.built_at,
            hex_count: self.hex_count,
            sigma_squared: self.sigma_squared,
            faiss_index_type: self.faiss_index_type,
            data_sources: self.data_sources,
            hexagons: self
                .hexagons
                .into_iter()
                .map(|h| HexVector {
                    h3_index: h.h3_index,
                    lat: h.lat,
                    lon: h.lon,
                    admin_name: h.admin_name,
                    admin_level: h.admin_level,
                    country_code: String::new(), // not stored in original format
                    parent_city_id: h.parent_city_id,
                    parent_city_name: h.parent_city_name,
                    vector: h.vector,
                    poi_counts: [0; 7],
                })
                .collect(),
        }
    }
}