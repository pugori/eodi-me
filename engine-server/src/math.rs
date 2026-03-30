//! Internal vector math utilities.

/// Squared Euclidean distance between two 13D f32 vectors.
///
/// Uses a simple loop — the compiler auto-vectorizes this to SIMD on
/// x86_64 and aarch64 with opt-level >= 2.
#[inline]
pub fn l2_squared(a: &[f32; 13], b: &[f32; 13]) -> f32 {
    a.iter()
        .zip(b.iter())
        .map(|(&x, &y)| {
            let d = x - y;
            d * d
        })
        .sum()
}

/// Convert a 13D vector to the 6-axis radar chart.
///
/// Not called in the main search path but kept as a utility for external
/// callers (e.g. test fixtures, future gRPC export endpoint).
#[allow(dead_code)]
pub fn vector_to_radar(v: &[f32; 13]) -> serde_json::Value {
    serde_json::json!({
        "active":  v[0],
        "classic": v[1],
        "quiet":   v[2],
        "trendy":  v[3],
        "nature":  v[4],
        "urban":   v[5],
    })
}

/// Compute 6-axis vibe ratios from raw POI category counts.
/// Optionally merges `user_counts` before computing ratios.
/// Falls back to pre-computed vector dims for legacy data.
pub fn compute_vibe_from_poi(
    poi_counts: &[u32; 7],
    user_counts: Option<&[u32; 7]>,
    vector: &[f32; 13],
) -> serde_json::Value {
    // Legacy fallback: if base poi_counts total is 0 and no user overlay,
    // use pre-computed vector dims 0–5 (old .edbh without poi_counts).
    if poi_counts[6] == 0 && user_counts.is_none() {
        return vector_to_radar(vector);
    }

    let merged: [u32; 7] = if let Some(uc) = user_counts {
        [
            poi_counts[0] + uc[0],
            poi_counts[1] + uc[1],
            poi_counts[2] + uc[2],
            poi_counts[3] + uc[3],
            poi_counts[4] + uc[4],
            poi_counts[5] + uc[5],
            poi_counts[6] + uc[6],
        ]
    } else {
        *poi_counts
    };

    let total = merged[6].max(1) as f32; // avoid division by zero
    serde_json::json!({
        "active":  (merged[0] as f32 / total).clamp(0.0, 1.0),
        "classic": (merged[1] as f32 / total).clamp(0.0, 1.0),
        "quiet":   (merged[2] as f32 / total).clamp(0.0, 1.0),
        "trendy":  (merged[3] as f32 / total).clamp(0.0, 1.0),
        "nature":  (merged[4] as f32 / total).clamp(0.0, 1.0),
        "urban":   (merged[5] as f32 / total).clamp(0.0, 1.0),
    })
}

/// Recompute the 6-axis vibe dimensions (0–5) of a 13D vector from raw POI counts.
///
/// Used to rebuild a full 13D vector when user data has been merged,
/// so that similarity search (`l2_squared`) reflects the merged vibe.
pub fn rebuild_vibe_dims(vector: &mut [f32; 13], poi_counts: &[u32; 7], user_counts: Option<&[u32; 7]>) {
    let merged: [u32; 7] = if let Some(uc) = user_counts {
        [
            poi_counts[0] + uc[0],
            poi_counts[1] + uc[1],
            poi_counts[2] + uc[2],
            poi_counts[3] + uc[3],
            poi_counts[4] + uc[4],
            poi_counts[5] + uc[5],
            poi_counts[6] + uc[6],
        ]
    } else {
        return; // no user data, keep pre-computed dims 0-5
    };

    let total = merged[6].max(1) as f32;
    vector[0] = (merged[0] as f32 / total).clamp(0.0, 1.0);
    vector[1] = (merged[1] as f32 / total).clamp(0.0, 1.0);
    vector[2] = (merged[2] as f32 / total).clamp(0.0, 1.0);
    vector[3] = (merged[3] as f32 / total).clamp(0.0, 1.0);
    vector[4] = (merged[4] as f32 / total).clamp(0.0, 1.0);
    vector[5] = (merged[5] as f32 / total).clamp(0.0, 1.0);
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn l2_zero_distance() {
        let a = [0.5f32; 13];
        assert!(l2_squared(&a, &a) < 1e-10);
    }

    #[test]
    fn l2_known_distance() {
        let a = [0.0f32; 13];
        let b = [1.0f32; 13];
        assert!((l2_squared(&a, &b) - 13.0).abs() < 1e-6);
    }

    #[test]
    fn radar_values() {
        let v = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0f32];
        let radar = vector_to_radar(&v);
        assert_eq!(radar["active"], 0.1f32);
        assert_eq!(radar["classic"], 0.2f32);
        assert_eq!(radar["quiet"], 0.3f32);
        assert_eq!(radar["urban"], 0.6f32);
    }
}
