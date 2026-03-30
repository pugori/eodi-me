//! Pipeline helper functions — city file parsing and data collection.

use anyhow::Result;
use std::path::PathBuf;

use crate::city::{CityBasic, CityData};

// ─────────────────────────────────────────────────────────────────────────────
// cities15000.txt parser
// ─────────────────────────────────────────────────────────────────────────────

/// Parse GeoNames `cities15000.txt` (tab-separated) into `CityBasic` records.
///
/// * `limit = 0` → load all rows
pub async fn parse_cities_file(path: &PathBuf, limit: usize) -> Result<Vec<CityBasic>> {
    use tokio::io::{AsyncBufReadExt, BufReader};
    use tokio::fs::File;

    let file = File::open(path).await?;
    let reader = BufReader::new(file);
    let mut lines = reader.lines();
    let mut cities = Vec::new();

    while let Some(line) = lines.next_line().await? {
        let fields: Vec<&str> = line.split('\t').collect();
        if fields.len() < 19 {
            continue;
        }

        let city = CityBasic {
            geoname_id:   fields[0].parse().unwrap_or(0),
            name:         fields[1].to_string(),
            ascii_name:   fields[2].to_string(),
            latitude:     fields[4].parse().unwrap_or(0.0),
            longitude:    fields[5].parse().unwrap_or(0.0),
            country_code: fields[8].to_string(),
            population:   fields[14].parse().unwrap_or(0),
            timezone:     fields[17].to_string(),
        };

        if city.geoname_id > 0 {
            cities.push(city);
        }

        if limit > 0 && cities.len() >= limit {
            break;
        }
    }

    Ok(cities)
}

// ─────────────────────────────────────────────────────────────────────────────
// City data assembly from country cache
// ─────────────────────────────────────────────────────────────────────────────

/// Build `CityData` from in-memory country cache — **pure sync**, no I/O.
pub fn collect_city_data_sync(
    country_cache: &std::collections::HashMap<String, Option<String>>,
    city: &CityBasic,
) -> CityData {
    let country_info = country_cache
        .get(&city.country_code)
        .and_then(|v| v.clone());

    CityData {
        basic: city.clone(),
        country_info,
        collected_at: chrono::Utc::now(),
    }
}

/// Async wrapper (cache is already warm — no network I/O inside).
pub async fn collect_city_data(
    country_cache: &std::collections::HashMap<String, Option<String>>,
    city: &CityBasic,
) -> CityData {
    collect_city_data_sync(country_cache, city)
}
