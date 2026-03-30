//! Encrypted 15D Vector Database (.edb format)
//!
//! # File format
//! ```
//! [MAGIC: 4B "EDB1"] [VERSION: 1B] [SALT: 32B] [NONCE: 12B]
//! [PAYLOAD_LEN: 8B LE u64] [CIPHERTEXT: variable]
//! ```
//!
//! # Key
//! 32-byte AES-256 key embedded at compile time (in binary).
//! Not derived from a user password — only the developer builds .edb files.
//! The engine decrypts at runtime using the same embedded key.
//!
//! # Encryption
//! AES-256-GCM — authenticated encryption (AEAD).
//! 96-bit random nonce per file.
//! Authentication tag prevents tampering detection.
//!
//! # Payload
//! `bincode`-serialized `VectorDatabase` struct.
//! Uses f32 (not f64) for vectors: 60 bytes/city × 50,000 = 3MB (small enough to load in full)

use aes_gcm::{
    aead::Aead,
    Aes256Gcm, KeyInit, Nonce,
};
use anyhow::{anyhow, Result};
use rand::{rngs::OsRng, RngCore};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::Path;
use zeroize::Zeroize;

// ─────────────────────────────────────────────────────────────────────────────
// Format constants
// ─────────────────────────────────────────────────────────────────────────────

const EDB_MAGIC: &[u8; 4] = b"EDB1";
const EDB_VERSION: u8 = 1;
const NONCE_SIZE: usize = 12;

/// AES-256 key embedded at compile time.
/// Both the collector (encrypt) and engine (decrypt) share this key via the compiled binary.
/// Never exposed externally — key exists only inside the binary.
const EDB_KEY: &[u8; 32] = b"\x4e\x8f\x2a\x71\xc3\x95\xd6\x04\
                               \xb7\x3e\x58\x1a\xf9\x0d\x62\x87\
                               \x3c\xa4\x19\x5e\x7b\xd0\xf2\x8c\
                               \x96\x2f\xe1\x4a\xb8\x05\x6d\x3a";

// ─────────────────────────────────────────────────────────────────────────────
// Data structures
// ─────────────────────────────────────────────────────────────────────────────

/// Per-city 15D matching vector entry.
///
/// Uses f32 (4 bytes × 15 = 60 bytes per city) to minimize file size
/// while retaining sufficient precision for FAISS L2 distance computation.
/// 50,000 cities × 60 bytes = 3MB base payload.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CityVector {
    pub geoname_id: i64,
    pub name: String,
    pub ascii_name: String,
    pub country_code: String,
    pub latitude: f32,
    pub longitude: f32,
    pub population: i64,
    pub timezone: String,
    /// 13D matching vector — all values in [0.0, 1.0]
    /// dim[0..5]  : Urban Vibe 6-axis (vitality, culture, relief, rhythm, lifestyle, commercial)
    /// dim[6]     : poi_density_norm (within-country percentile)
    /// dim[7]     : category_diversity_norm (Shannon entropy / log(7))
    /// dim[8]     : water_proximity_norm (inv-distance percentile)
    /// dim[9]     : temporal_entropy_norm (fallback: POI-based)
    /// dim[10]    : flow_to_poi_ratio_norm (fallback: POI-based)
    /// dim[11]    : population_density_norm (log-population percentile)
    /// dim[12]    : transit_accessibility_norm (OSM real-data or fallback)
    pub vector: [f32; 13],
}

/// Per-hexagon 13D matching vector entry.
///
/// Uses the same 13D spec as CityVector but at the neighbourhood (H3 Res-8) scale.
/// ~400,000 entries × 52 bytes ≈ 20MB base payload.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HexVector {
    /// H3 Res-8 cell index (uint64).
    pub h3_index: u64,
    /// Centroid latitude.
    pub lat: f32,
    /// Centroid longitude.
    pub lon: f32,
    /// Name of the administrative area (OSM admin boundary).
    pub admin_name: String,
    /// OSM admin_level (higher = more specific, e.g. 10 = 동).
    pub admin_level: u8,
    /// ISO 3166-1 alpha-2 country code (e.g. "KR", "JP").
    pub country_code: String,
    /// GeoNames geoname_id of parent city.
    pub parent_city_id: i64,
    /// Parent city name.
    pub parent_city_name: String,
    /// 13D matching vector — all values in [0.0, 1.0].
    /// Same dimension definitions as CityVector.vector.
    pub vector: [f32; 13],
}

/// Extended root structure: hexagon-level 15D vector database.
///
/// Stored as `.edbh` (EBH2 magic). The `index` field is NOT serialised —
/// it is rebuilt at load time from `hexagons` for zero file-size overhead.
///
/// # Lookup patterns
/// - **Direct H3 lookup** (`O(1)`): `db.get(h3_index)` — "which neighbourhood is this cell?"
/// - **Adjacent traversal**: `grid_disk(cell, k)` then `get()` each result
/// - **Similarity search** (future): HNSW stored separately at engine stage
#[derive(Debug, Serialize, Deserialize)]
pub struct HexVectorDatabase {
    pub schema_version: u8,
    pub spec_version: String,
    pub built_at: String,
    pub hex_count: u32,
    /// σ² for FAISS Gaussian RBF kernel (computed from hex vectors).
    pub sigma_squared: f64,
    pub faiss_index_type: String,
    pub data_sources: Vec<DataSource>,
    /// Ordered hexagon list — source of truth, serialised to file.
    pub hexagons: Vec<HexVector>,
    /// H3 index → position in `hexagons` Vec.  O(1) lookup.  NOT serialised.
    #[serde(skip)]
    pub index: HashMap<u64, u32>,
}

impl HexVectorDatabase {
    pub fn new(hexagons: Vec<HexVector>) -> Self {
        let hex_count = hexagons.len() as u32;

        let faiss_index_type = if hex_count < 10_000 {
            "IndexFlatL2".to_string()
        } else {
            format!(
                "IndexIVFFlat(nlist={}, nprobe={})",
                (hex_count as f64).sqrt().ceil() as u32,
                ((hex_count as f64).sqrt().sqrt()).ceil() as u32,
            )
        };

        // Build O(1) lookup index: h3_index → position in Vec
        let index: HashMap<u64, u32> = hexagons
            .iter()
            .enumerate()
            .map(|(pos, h)| (h.h3_index, pos as u32))
            .collect();

        let mut db = HexVectorDatabase {
            schema_version: 2,
            spec_version: "v6.1-hex".to_string(),
            built_at: chrono::Utc::now().to_rfc3339(),
            hex_count,
            sigma_squared: 1.0,
            faiss_index_type,
            data_sources: vec![
                DataSource {
                    name: "OpenStreetMap via Overpass API".to_string(),
                    license: "ODbL 1.0 — attribution required".to_string(),
                    url: "https://www.openstreetmap.org/copyright".to_string(),
                },
                DataSource {
                    name: "H3 Hexagonal Hierarchical Geospatial Indexing System".to_string(),
                    license: "Apache 2.0".to_string(),
                    url: "https://h3geo.org/".to_string(),
                },
            ],
            hexagons,
            index,
        };

        db.sigma_squared = db.compute_sigma_squared();
        db
    }

    /// Reconstruct the `index` HashMap from `hexagons` Vec after deserialisation.
    /// Called automatically by `decrypt_from_file`.
    #[allow(dead_code)]
    fn rebuild_index(&mut self) {
        self.index = self.hexagons
            .iter()
            .enumerate()
            .map(|(pos, h)| (h.h3_index, pos as u32))
            .collect();
    }

    /// O(1) hexagon lookup by H3 cell index.
    ///
    /// Returns `None` if the cell is not in the database.
    #[inline]
    #[allow(dead_code)]
    pub fn get(&self, h3_index: u64) -> Option<&HexVector> {
        self.index.get(&h3_index).map(|&pos| &self.hexagons[pos as usize])
    }

    /// O(1) mutable hexagon lookup by H3 cell index.
    #[inline]
    #[allow(dead_code)]
    pub fn get_mut(&mut self, h3_index: u64) -> Option<&mut HexVector> {
        if let Some(&pos) = self.index.get(&h3_index) {
            Some(&mut self.hexagons[pos as usize])
        } else {
            None
        }
    }

    /// Check if a hexagon exists in the database.
    #[inline]
    #[allow(dead_code)]
    pub fn contains(&self, h3_index: u64) -> bool {
        self.index.contains_key(&h3_index)
    }

    fn compute_sigma_squared(&self) -> f64 {
        use rayon::prelude::*;

        let n = self.hexagons.len();
        if n < 10 { return 1.0; }

        let k = 5usize;
        let vecs: Vec<[f64; 15]> = self.hexagons.iter().map(|h| {
            let mut v = [0.0f64; 15];
            for (dst, src) in v.iter_mut().zip(h.vector.iter()) {
                *dst = *src as f64;
            }
            v
        }).collect();

        let sample_size = n.min(2_000);
        let step = (n / sample_size).max(1);

        let mut knn: Vec<f64> = (0..sample_size).into_par_iter().map(|si| {
            let i = si * step;
            let vi = &vecs[i];
            let mut dists: Vec<f64> = vecs.iter().enumerate()
                .filter(|&(j, _)| j != i)
                .map(|(_, vj)| l2_squared(vi, vj))
                .collect();
            dists.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
            dists.get(k - 1).copied().unwrap_or(1.0)
        }).collect();

        knn.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
        let median = knn[knn.len() / 2];
        (median / std::f64::consts::LN_2).max(1e-6)
    }

    /// Encrypt to `.edbh` (hex vector DB) file using the embedded key.
    ///
    /// The `index` HashMap is NOT serialised — it is rebuilt from `hexagons` on load.
    /// Magic bytes: `EBH2` (schema v2, HashMap-indexed).
    pub fn encrypt_to_file<P: AsRef<Path>>(&self, path: P) -> Result<()> {
        let payload = bincode::serialize(self)
            .map_err(|e| anyhow!("Hex DB serialisation failed: {}", e))?;

        let mut nonce_bytes = [0u8; NONCE_SIZE];
        OsRng.fill_bytes(&mut nonce_bytes);

        let cipher = Aes256Gcm::new(EDB_KEY.into());
        let nonce = Nonce::from_slice(&nonce_bytes);
        let ciphertext = cipher
            .encrypt(nonce, payload.as_ref())
            .map_err(|e| anyhow!("AES-GCM encryption failed: {}", e))?;

        let mut file = std::fs::File::create(path.as_ref())
            .map_err(|e| anyhow!("Cannot create .edbh file: {}", e))?;

        file.write_all(b"EBH2")?; // v2 magic: HashMap-indexed hex DB
        file.write_all(&[EDB_VERSION])?;
        file.write_all(&nonce_bytes)?;
        file.write_all(&(ciphertext.len() as u64).to_le_bytes())?;
        file.write_all(&ciphertext)?;

        tracing::info!(
            "🔒 Encrypted {} hexagons → {:?} ({:.1} MB, index={} entries)",
            self.hex_count,
            path.as_ref(),
            (5 + NONCE_SIZE + 8 + ciphertext.len()) as f64 / 1_048_576.0,
            self.index.len(),
        );
        Ok(())
    }

    /// Decrypt and load hex vector database from `.edbh` file.
    ///
    /// Supports both `EBH1` (schema v1, Vec-only) and `EBH2` (schema v2, HashMap-indexed).
    /// After deserialisation, rebuilds the `index` HashMap in O(n) time.
    /// Reserved for engine-side loading (not used in the collector binary).
    #[allow(dead_code)]
    pub fn decrypt_from_file<P: AsRef<Path>>(path: P) -> Result<Self> {
        let mut file = std::fs::File::open(path.as_ref())
            .map_err(|e| anyhow!("Cannot open .edbh file: {}", e))?;

        let mut magic = [0u8; 4];
        file.read_exact(&mut magic)?;
        match &magic {
            b"EBH1" | b"EBH2" => {}
            _ => return Err(anyhow!("Not a valid .edbh file (expected EBH1/EBH2, got {:?})", magic)),
        }

        let mut version = [0u8; 1];
        file.read_exact(&mut version)?;

        let mut nonce_bytes = [0u8; NONCE_SIZE];
        file.read_exact(&mut nonce_bytes)?;

        let mut len_bytes = [0u8; 8];
        file.read_exact(&mut len_bytes)?;
        let ct_len = u64::from_le_bytes(len_bytes) as usize;

        let mut ciphertext = vec![0u8; ct_len];
        file.read_exact(&mut ciphertext)?;

        let cipher = Aes256Gcm::new(EDB_KEY.into());
        let nonce = Nonce::from_slice(&nonce_bytes);
        let mut plaintext = cipher
            .decrypt(nonce, ciphertext.as_ref())
            .map_err(|_| anyhow!("Hex DB decryption failed — corrupted file"))?;

        let mut db: HexVectorDatabase = bincode::deserialize(&plaintext)
            .map_err(|e| anyhow!("Hex DB deserialisation failed: {}", e))?;
        plaintext.zeroize();

        // Rebuild O(1) lookup index from the deserialised Vec
        db.rebuild_index();

        tracing::info!(
            "🔓 Loaded {} hexagons from {:?} (index={} entries)",
            db.hex_count,
            path.as_ref(),
            db.index.len(),
        );
        Ok(db)
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct VectorDatabase {
    /// Schema version — increment on breaking changes
    pub schema_version: u8,
    /// Spec version this was built against
    pub spec_version: String,
    /// ISO 8601 build timestamp
    pub built_at: String,
    /// Number of cities in this database
    pub city_count: u32,
    /// Pre-computed σ² for FAISS Gaussian RBF kernel.
    /// Formula: σ² = median(5th-NN L2²) / ln(2)
    /// Ensures median similarity ≈ 50% for the 5th nearest neighbor.
    pub sigma_squared: f64,
    /// FAISS index type recommendation
    pub faiss_index_type: String,
    /// Data source attribution (license compliance)
    pub data_sources: Vec<DataSource>,
    /// All city vectors
    pub cities: Vec<CityVector>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DataSource {
    pub name: String,
    pub license: String,
    pub url: String,
}

impl VectorDatabase {
    pub fn new(cities: Vec<CityVector>) -> Self {
        let city_count = cities.len() as u32;

        // Recommend FAISS index type based on dataset size
        // Spec §5.4: <10,000 → IndexFlatL2, ≥10,000 → IndexIVFFlat
        let faiss_index_type = if city_count < 10_000 {
            "IndexFlatL2".to_string()
        } else {
            format!(
                "IndexIVFFlat(nlist={}, nprobe={})",
                (city_count as f64).sqrt().ceil() as u32,
                ((city_count as f64).sqrt().sqrt()).ceil() as u32,
            )
        };

        let mut db = VectorDatabase {
            schema_version: 1,
            spec_version: "v6.0".to_string(),
            built_at: chrono::Utc::now().to_rfc3339(),
            city_count,
            sigma_squared: 1.0, // will be computed below
            faiss_index_type,
            data_sources: vec![
                DataSource {
                    name: "GeoNames cities15000".to_string(),
                    license: "CC BY 4.0".to_string(),
                    url: "https://www.geonames.org/".to_string(),
                },
                DataSource {
                    name: "OpenStreetMap via Overpass API".to_string(),
                    license: "ODbL 1.0 — attribution required".to_string(),
                    url: "https://www.openstreetmap.org/copyright".to_string(),
                },
                DataSource {
                    name: "Open-Meteo Historical Archive".to_string(),
                    license: "CC BY 4.0".to_string(),
                    url: "https://open-meteo.com/".to_string(),
                },
            ],
            cities,
        };

        // Compute sigma² using median 5th-NN L2² distance
        // This auto-calibrates Gaussian RBF so median similarity ≈ 50%
        db.sigma_squared = db.compute_sigma_squared();
        db
    }

    /// Compute σ² = median(5th-NN L2²) / ln(2) using rayon parallel processing.
    ///
    /// For each city, find its 5th nearest neighbor's L2² distance.
    /// Take the median of all these distances and divide by ln(2).
    /// Result: the 5th nearest neighbor will have ~50% similarity on average.
    ///
    /// Complexity: O(n² / chunk_size) with parallel chunks.
    /// For 50k cities: ~2.5B comparisons. Use chunk-based parallel approach.
    pub fn compute_sigma_squared(&self) -> f64 {
        use rayon::prelude::*;

        let n = self.cities.len();
        if n < 10 {
            return 1.0;
        }

        let k = 5usize; // 5th nearest neighbor per spec §5.3

        // Extract vectors as flat f64 arrays for computation
        let vecs: Vec<[f64; 15]> = self
            .cities
            .iter()
            .map(|c| {
                let mut v = [0.0f64; 15];
                for (dst, src) in v.iter_mut().zip(c.vector.iter()) {
                    *dst = *src as f64;
                }
                v
            })
            .collect();

        // For large datasets, sample 2000 cities to estimate median efficiently
        // Preserves statistical accuracy while avoiding O(n²) cost
        let sample_size = n.min(2_000);
        let step = n / sample_size;

        let mut knn_l2_sq: Vec<f64> = (0..sample_size)
            .into_par_iter()
            .map(|sample_idx| {
                let i = sample_idx * step;
                let vi = &vecs[i];

                // Compute L2² to all other cities, keep k smallest
                let mut dists: Vec<f64> = vecs
                    .iter()
                    .enumerate()
                    .filter(|&(j, _)| j != i)
                    .map(|(_, vj)| l2_squared(vi, vj))
                    .collect();

                // Partial sort: only need k-th smallest
                dists.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
                dists.get(k - 1).copied().unwrap_or(1.0)
            })
            .collect();

        knn_l2_sq.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
        let median = knn_l2_sq[knn_l2_sq.len() / 2];

        // σ² = median(k-NN L2²) / ln(2) — calibrates 5th NN to ~50% similarity
        let sigma_sq = median / std::f64::consts::LN_2;
        sigma_sq.max(1e-6) // prevent division by zero in engine
    }

    /// Serialize with bincode + encrypt with AES-256-GCM (embedded key).
    /// Output: .edb binary file.
    pub fn encrypt_to_file<P: AsRef<Path>>(&self, path: P) -> Result<()> {
        // 1. Serialize payload
        let payload = bincode::serialize(self)
            .map_err(|e| anyhow!("Serialization failed: {}", e))?;

        // 2. Generate cryptographically random nonce (unique per file)
        let mut nonce_bytes = [0u8; NONCE_SIZE];
        OsRng.fill_bytes(&mut nonce_bytes);

        // 3. AES-256-GCM encryption using embedded key
        let cipher = Aes256Gcm::new(EDB_KEY.into());
        let nonce = Nonce::from_slice(&nonce_bytes);
        let ciphertext = cipher
            .encrypt(nonce, payload.as_ref())
            .map_err(|e| anyhow!("AES-GCM encryption failed: {}", e))?;

        // 4. Write file: MAGIC + VERSION + NONCE + LEN + CIPHERTEXT
        let mut file = std::fs::File::create(path.as_ref())
            .map_err(|e| anyhow!("Cannot create output file: {}", e))?;

        file.write_all(EDB_MAGIC)?;
        file.write_all(&[EDB_VERSION])?;
        file.write_all(&nonce_bytes)?;
        file.write_all(&(ciphertext.len() as u64).to_le_bytes())?;
        file.write_all(&ciphertext)?;

        tracing::info!(
            "🔒 Encrypted {} cities → {:?} ({:.1} MB)",
            self.city_count,
            path.as_ref(),
            (5 + NONCE_SIZE + 8 + ciphertext.len()) as f64 / 1_048_576.0,
        );

        Ok(())
    }

    /// Decrypt and load vector database from .edb file (used by engine).
    /// Uses the same embedded key as encrypt_to_file.
    #[allow(dead_code)]
    pub fn decrypt_from_file<P: AsRef<Path>>(path: P) -> Result<Self> {
        let mut file = std::fs::File::open(path.as_ref())
            .map_err(|e| anyhow!("Cannot open EDB file: {}", e))?;

        let mut magic = [0u8; 4];
        file.read_exact(&mut magic)?;
        if &magic != EDB_MAGIC {
            return Err(anyhow!("Not a valid .edb file (wrong magic bytes)"));
        }

        let mut version = [0u8; 1];
        file.read_exact(&mut version)?;
        if version[0] != EDB_VERSION {
            return Err(anyhow!(
                "Unsupported .edb version: {} (expected {})",
                version[0],
                EDB_VERSION
            ));
        }

        let mut nonce_bytes = [0u8; NONCE_SIZE];
        file.read_exact(&mut nonce_bytes)?;

        let mut len_bytes = [0u8; 8];
        file.read_exact(&mut len_bytes)?;
        let ciphertext_len = u64::from_le_bytes(len_bytes) as usize;

        let mut ciphertext = vec![0u8; ciphertext_len];
        file.read_exact(&mut ciphertext)?;

        // AES-256-GCM decryption using embedded key
        let cipher = Aes256Gcm::new(EDB_KEY.into());
        let nonce = Nonce::from_slice(&nonce_bytes);
        let mut plaintext = cipher
            .decrypt(nonce, ciphertext.as_ref())
            .map_err(|_| anyhow!("Decryption failed — corrupted .edb file or version mismatch"))?;

        // Deserialize
        let db: VectorDatabase = bincode::deserialize(&plaintext)
            .map_err(|e| anyhow!("Deserialization failed: {}", e))?;

        plaintext.zeroize();

        Ok(db)
    }

    /// Quick integrity check after loading.
    pub fn validate(&self) -> Result<()> {
        for (i, city) in self.cities.iter().enumerate() {
            for (dim, &v) in city.vector.iter().enumerate() {
                if !(0.0..=1.0).contains(&v) || !v.is_finite() {
                    return Err(anyhow!(
                        "Invalid vector at city {} ({}): dim {} = {}",
                        i,
                        city.name,
                        dim,
                        v
                    ));
                }
            }
        }
        Ok(())
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────────────

#[inline]
fn l2_squared(a: &[f64; 15], b: &[f64; 15]) -> f64 {
    a.iter()
        .zip(b.iter())
        .map(|(&x, &y)| (x - y) * (x - y))
        .sum()
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn make_test_city(id: i64, vector: [f32; 15]) -> CityVector {
        CityVector {
            geoname_id: id,
            name: format!("City{}", id),
            ascii_name: format!("City{}", id),
            country_code: "KR".to_string(),
            latitude: 37.5,
            longitude: 127.0,
            population: 100_000,
            timezone: "Asia/Seoul".to_string(),
            vector,
        }
    }

    #[test]
    fn test_encrypt_decrypt_roundtrip() {
        let cities = vec![
            make_test_city(1, [0.5f32; 15]),
            make_test_city(2, [0.8, 0.3, 0.1, 0.7, 0.6, 0.4, 0.9, 0.5, 0.2, 0.55, 0.48, 0.61, 0.58, 0.82, 0.91]),
        ];

        let db = VectorDatabase::new(cities);
        assert!(db.sigma_squared > 0.0, "sigma_squared should be positive");

        let mut tmp_path = std::env::temp_dir();
        tmp_path.push(format!(
            "eodi-vdb-test-{}-{}.edb",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));

        db.encrypt_to_file(&tmp_path).unwrap();
        let loaded = VectorDatabase::decrypt_from_file(&tmp_path).unwrap();

        assert_eq!(loaded.city_count, 2);
        assert_eq!(loaded.cities[0].geoname_id, 1);
        assert_eq!(loaded.cities[1].vector[0], 0.8f32);

        let _ = std::fs::remove_file(&tmp_path);
    }

    #[test]
    fn test_validate_valid_vectors() {
        let cities = vec![make_test_city(1, [0.5f32; 15])];
        let db = VectorDatabase::new(cities);
        assert!(db.validate().is_ok());
    }

    #[test]
    fn test_sigma_squared_positive() {
        let cities: Vec<CityVector> = (0..20)
            .map(|i| {
                let v = i as f32 / 20.0;
                make_test_city(i, [v; 15])
            })
            .collect();
        let db = VectorDatabase::new(cities);
        assert!(db.sigma_squared > 0.0);
        assert!(db.sigma_squared.is_finite());
    }
}
