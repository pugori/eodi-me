//! User POI overlay — separate from the immutable hex VDB.
//!
//! Stores per-hexagon user-contributed POI category counts in memory,
//! persisted to a JSON file alongside the `.edbh` database.
//!
//! # Design
//! - The original `.edbh` is **never modified** — it is read-only.
//! - User overlays live in `user_overlay.json` next to the `.edbh` file.
//! - When computing 6-axis vibe (radar), the engine merges the overlay
//!   counts with the original `poi_counts` on-the-fly via
//!   `math::compute_vibe_from_poi(base, Some(user))`.
//! - Overlays are additive: they represent *additional* POIs the user
//!   attributes to a hexagon, not replacements.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::RwLock;

/// Per-hexagon user POI overlay: [vitality, culture, relief, rhythm, lifestyle, commercial, total].
pub type PoiOverlay = [u32; 7];

/// Thread-safe, file-backed user overlay store.
///
/// All reads/writes go through `RwLock` so concurrent HTTP handlers
/// are safe without `Arc<Mutex>` — the `RwLock` allows many readers.
pub struct UserOverlayStore {
    data: RwLock<HashMap<u64, PoiOverlay>>,
    file_path: PathBuf,
}

/// JSON serialisation wrapper (H3 index as string key for JSON compat).
#[derive(Serialize, Deserialize)]
struct OverlayFile {
    version: u8,
    overlays: HashMap<String, PoiOverlay>,
}

impl UserOverlayStore {
    /// Create a new overlay store.  If a persisted file exists, loads it.
    pub fn new(edbh_path: &Path) -> Self {
        let file_path = edbh_path
            .parent()
            .unwrap_or_else(|| Path::new("."))
            .join("user_overlay.json");

        let data = if file_path.exists() {
            match std::fs::read_to_string(&file_path) {
                Ok(contents) => match serde_json::from_str::<OverlayFile>(&contents) {
                    Ok(file) => {
                        let map: HashMap<u64, PoiOverlay> = file
                            .overlays
                            .into_iter()
                            .filter_map(|(k, v)| k.parse::<u64>().ok().map(|h3| (h3, v)))
                            .collect();
                        tracing::info!("Loaded {} user overlays from {}", map.len(), file_path.display());
                        map
                    }
                    Err(e) => {
                        tracing::warn!("Failed to parse user overlay file: {}", e);
                        HashMap::new()
                    }
                },
                Err(e) => {
                    tracing::warn!("Failed to read user overlay file: {}", e);
                    HashMap::new()
                }
            }
        } else {
            tracing::info!("No user overlay file found at {} — starting empty", file_path.display());
            HashMap::new()
        };

        Self {
            data: RwLock::new(data),
            file_path,
        }
    }

    /// Get user overlay for a specific hexagon. Returns `None` if no overlay exists.
    pub fn get(&self, h3_index: u64) -> Option<PoiOverlay> {
        self.data.read().unwrap_or_else(|e| {
            tracing::error!("RwLock poisoned in UserOverlayStore::get — recovering");
            e.into_inner()
        }).get(&h3_index).copied()
    }

    /// Set (or replace) user overlay for a hexagon.
    /// Automatically persists to disk.
    pub fn set(&self, h3_index: u64, counts: PoiOverlay) -> anyhow::Result<()> {
        {
            let mut data = self.data.write().unwrap_or_else(|e| {
                tracing::error!("RwLock poisoned in UserOverlayStore::set — recovering");
                e.into_inner()
            });
            data.insert(h3_index, counts);
        }
        self.persist()
    }

    /// Remove user overlay for a hexagon.
    /// Returns `true` if an overlay was actually removed.
    pub fn remove(&self, h3_index: u64) -> anyhow::Result<bool> {
        let removed = {
            let mut data = self.data.write().unwrap_or_else(|e| {
                tracing::error!("RwLock poisoned in UserOverlayStore::remove — recovering");
                e.into_inner()
            });
            data.remove(&h3_index).is_some()
        };
        if removed {
            self.persist()?;
        }
        Ok(removed)
    }

    /// List all overlay entries.
    pub fn list(&self) -> HashMap<u64, PoiOverlay> {
        self.data.read().unwrap_or_else(|e| {
            tracing::error!("RwLock poisoned in UserOverlayStore::list — recovering");
            e.into_inner()
        }).clone()
    }

    /// Number of hexagons with user overlays.
    pub fn count(&self) -> usize {
        self.data.read().unwrap_or_else(|e| {
            tracing::error!("RwLock poisoned in UserOverlayStore::count — recovering");
            e.into_inner()
        }).len()
    }

    /// Remove all user overlays. Persists the empty state.
    pub fn clear(&self) -> anyhow::Result<()> {
        {
            let mut data = self.data.write().unwrap_or_else(|e| {
                tracing::error!("RwLock poisoned in UserOverlayStore::clear — recovering");
                e.into_inner()
            });
            data.clear();
        }
        self.persist()
    }

    /// Persist current state to `user_overlay.json`.
    fn persist(&self) -> anyhow::Result<()> {
        let data = self.data.read().unwrap_or_else(|e| e.into_inner());
        let file = OverlayFile {
            version: 1,
            overlays: data
                .iter()
                .map(|(k, v)| (k.to_string(), *v))
                .collect(),
        };
        let json = serde_json::to_string_pretty(&file)?;
        std::fs::write(&self.file_path, json)?;
        tracing::debug!("Persisted {} overlays to {}", data.len(), self.file_path.display());
        Ok(())
    }
}
