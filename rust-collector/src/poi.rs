//! OSM Overpass API POI data collector
//!
//! Data licenses:
//!   - OpenStreetMap: ODbL 1.0 (attribution required, commercial use OK)

use anyhow::{Result, anyhow};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tracing::debug;

// ─────────────────────────────────────────────────────────────────────────────
// POI counts (raw, pre-normalization)
// Covers all 13D dimensions from OSM data
// ─────────────────────────────────────────────────────────────────────────────

/// Raw POI counts from OSM Overpass API.
/// One instance per city, stored as JSON in `poi_data` column.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PoiCounts {
    // ── Layer A: Urban Vibe 6-axis (dim 0–5) ────────────────────────────────
    // Vitality: restaurant·cafe·bar·fast_food
    pub restaurant: u32,
    pub cafe: u32,
    pub bar: u32,
    pub fast_food: u32,

    // Culture: museum·theatre·library·gallery
    pub museum: u32,
    pub theatre: u32,
    pub library: u32,
    pub gallery: u32,

    // Relief: park·garden·sports_centre·spa
    pub park: u32,
    pub garden: u32,
    pub sports_centre: u32,
    pub spa: u32,

    // Rhythm: bus_station·atm·nightclub·cinema
    pub bus_station: u32,
    pub atm: u32,
    pub nightclub: u32,
    pub cinema: u32,

    // Lifestyle: cafe(shared)·beauty·hairdresser·gym
    pub beauty: u32,
    pub hairdresser: u32,
    pub gym: u32,

    // Commercial: supermarket·mall·shop·marketplace
    pub supermarket: u32,
    pub mall: u32,
    pub shop_generic: u32,
    pub marketplace: u32,

    // ── Layer B: POI profile (dim 6–7) ──────────────────────────────────────
    /// Total POI count within query radius
    pub total_poi: u32,
    /// Query radius in km
    pub radius_km: f64,

    // ── Layer C: Water proximity (dim 8) ────────────────────────────────────
    /// Distance to nearest water body in km (None = not found within 50km)
    pub nearest_water_km: Option<f64>,

    // ── Layer F: Transit accessibility (dim 12 — real OSM data) ─────────────
    /// Subway entrances within 800m
    pub subway_entrances: u32,
    /// Rail stations (non-subway) within 800m
    pub rail_stations: u32,
    /// Tram stops within 800m
    pub tram_stops: u32,
    /// Bus stops within 800m
    pub bus_stops: u32,
}

impl PoiCounts {
    // ── Axis totals for normalization ────────────────────────────────────────

    pub fn vitality_count(&self) -> u32 {
        self.restaurant + self.cafe + self.bar + self.fast_food
    }
    pub fn culture_count(&self) -> u32 {
        self.museum + self.theatre + self.library + self.gallery
    }
    pub fn relief_count(&self) -> u32 {
        self.park + self.garden + self.sports_centre + self.spa
    }
    pub fn rhythm_count(&self) -> u32 {
        self.bus_station + self.atm + self.nightclub + self.cinema
    }
    pub fn lifestyle_count(&self) -> u32 {
        // cafe shared with vitality axis (spec intentional overlap)
        self.cafe + self.beauty + self.hairdresser + self.gym
    }
    pub fn commercial_count(&self) -> u32 {
        self.supermarket + self.mall + self.shop_generic + self.marketplace
    }

    /// 7 category counts for Shannon entropy (dim 7).
    /// Categories: vitality, culture, relief, rhythm, lifestyle, commercial, other
    pub fn category_counts_for_entropy(&self) -> [f64; 7] {
        let v = self.vitality_count() as f64;
        let c = self.culture_count() as f64;
        let r = self.relief_count() as f64;
        let rh = self.rhythm_count() as f64;
        let l = self.lifestyle_count() as f64;
        let co = self.commercial_count() as f64;
        let total = self.total_poi as f64;
        // Other = all POI not in known categories (avoids losing unclassified POIs)
        let known = v + c + r + rh + l + co;
        let other = (total - known).max(0.0);
        [v, c, r, rh, l, co, other]
    }

    /// Raw transit score using mode weights from DATASET_VECTOR_SPEC.md §6
    /// Subway:1.0  Rail:0.9  Tram:0.6  Bus:0.3
    /// No frequency data available (GTFS unavailable) → assume freq_factor = 0.7
    pub fn transit_score_raw(&self) -> f64 {
        const FREQ_FACTOR: f64 = 0.7;
        (self.subway_entrances as f64 * 1.0
            + self.rail_stations as f64 * 0.9
            + self.tram_stops as f64 * 0.6
            + self.bus_stops as f64 * 0.3)
            * FREQ_FACTOR
    }

    /// POI density per km² based on query radius
    pub fn poi_density_per_km2(&self) -> f64 {
        if self.radius_km <= 0.0 {
            return 0.0;
        }
        let area_km2 = std::f64::consts::PI * self.radius_km * self.radius_km;
        self.total_poi as f64 / area_km2
    }
}

/// Accumulate POI counts field-by-field.
///
/// `radius_km` is intentionally excluded — it is a per-city constant, not
/// a quantity that makes sense to sum.
/// `nearest_water_km` is excluded too — it is merged via its own min-reduce
/// pass in `extract_poi_from_pbf`.
impl std::ops::AddAssign<&PoiCounts> for PoiCounts {
    fn add_assign(&mut self, rhs: &PoiCounts) {
        self.restaurant       += rhs.restaurant;
        self.cafe              += rhs.cafe;
        self.bar               += rhs.bar;
        self.fast_food         += rhs.fast_food;
        self.museum            += rhs.museum;
        self.theatre           += rhs.theatre;
        self.library           += rhs.library;
        self.gallery           += rhs.gallery;
        self.park              += rhs.park;
        self.garden            += rhs.garden;
        self.sports_centre     += rhs.sports_centre;
        self.spa               += rhs.spa;
        self.bus_station       += rhs.bus_station;
        self.atm               += rhs.atm;
        self.nightclub         += rhs.nightclub;
        self.cinema            += rhs.cinema;
        self.beauty            += rhs.beauty;
        self.hairdresser       += rhs.hairdresser;
        self.gym               += rhs.gym;
        self.supermarket       += rhs.supermarket;
        self.mall              += rhs.mall;
        self.shop_generic      += rhs.shop_generic;
        self.marketplace       += rhs.marketplace;
        self.subway_entrances  += rhs.subway_entrances;
        self.rail_stations     += rhs.rail_stations;
        self.tram_stops        += rhs.tram_stops;
        self.bus_stops         += rhs.bus_stops;
        self.total_poi         += rhs.total_poi;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Overpass API response types
// ─────────────────────────────────────────────────────────────────────────────

#[allow(dead_code)]
#[derive(Debug, Deserialize)]
struct OverpassResponse {
    elements: Vec<OverpassElement>,
}

#[allow(dead_code)]
#[derive(Debug, Deserialize)]
struct OverpassElement {
    #[serde(rename = "type")]
    #[allow(dead_code)]
    element_type: String,
    lat: Option<f64>,
    lon: Option<f64>,
    center: Option<OverpassCenter>,
    tags: Option<HashMap<String, String>>,
}

#[allow(dead_code)]
#[derive(Debug, Deserialize, Clone)]
struct OverpassCenter {
    lat: f64,
    lon: f64,
}

// ─────────────────────────────────────────────────────────────────────────────
// Overpass query builder
// ─────────────────────────────────────────────────────────────────────────────

pub fn poi_radius_meters(population: i64) -> u32 {
    match population {
        0..=50_000 => 3_000,
        50_001..=500_000 => 5_000,
        _ => 8_000,
    }
}

/// Builds a comprehensive Overpass QL query:
/// - POI for 6-axis Urban Vibe (within r_poi meters)
/// - Transit stops for dim 14 (within 800m)
/// - Water bodies for dim 8 (within 50km)
#[allow(dead_code)]
fn build_combined_query(lat: f64, lon: f64, r_poi: u32) -> String {
    format!(
        r#"[out:json][timeout:90];
(
  node["amenity"~"^(restaurant|cafe|bar|pub|fast_food|food_court)$"](around:{r},{lat},{lon});
  node["amenity"~"^(museum|theatre|library|arts_centre|cinema|nightclub|spa|atm|marketplace)$"](around:{r},{lat},{lon});
  node["amenity"="bus_station"](around:{r},{lat},{lon});
  node["leisure"~"^(park|garden|sports_centre|fitness_centre|swimming_pool)$"](around:{r},{lat},{lon});
  way["leisure"~"^(park|garden|sports_centre)$"](around:{r},{lat},{lon});
  node["shop"~"^(supermarket|mall|department_store|general|convenience|hairdresser|beauty|barber)$"](around:{r},{lat},{lon});
  way["shop"~"^(mall|supermarket|department_store)$"](around:{r},{lat},{lon});
  node["tourism"~"^(museum|gallery|artwork)$"](around:{r},{lat},{lon});
  node["highway"="bus_stop"](around:800,{lat},{lon});
  node["railway"~"^(station|subway_entrance|tram_stop|halt)$"](around:800,{lat},{lon});
  node["public_transport"~"^(stop_position|platform)$"](around:800,{lat},{lon});
  way["natural"~"^(water|coastline|bay)$"](around:50000,{lat},{lon});
  way["waterway"~"^(river|canal)$"](around:50000,{lat},{lon});
  relation["natural"="water"](around:50000,{lat},{lon});
);
out center tags;"#,
        r = r_poi,
        lat = lat,
        lon = lon,
    )
}

// ─────────────────────────────────────────────────────────────────────────────
// Tag → PoiCounts parsing
// ─────────────────────────────────────────────────────────────────────────────

fn is_water_element(tags: &HashMap<String, String>) -> bool {
    matches!(
        tags.get("natural").map(String::as_str),
        Some("water") | Some("coastline") | Some("bay")
    ) || matches!(
        tags.get("waterway").map(String::as_str),
        Some("river") | Some("canal")
    ) || tags.get("natural").map(String::as_str) == Some("water")
}

fn is_transit_element(tags: &HashMap<String, String>) -> bool {
    tags.contains_key("railway")
        || tags.get("highway").map(String::as_str) == Some("bus_stop")
        || tags.contains_key("public_transport")
}

/// Parse a single OSM element's tags into PoiCounts.
/// Returns (is_poi, is_transit, is_water) to categorize the element.
pub fn parse_element_tags(
    tags: &HashMap<String, String>,
    counts: &mut PoiCounts,
) -> (bool, bool, bool) {
    let mut is_poi = false;
    let mut is_transit = false;
    let mut is_water = false;

    // ── Water check ─────────────────────────────────────────────────────────
    if is_water_element(tags) {
        #[allow(unused_assignments)]
        {
            is_water = true;
        }
        return (false, false, true);
    }

    // ── Transit (800m radius, mode-weighted for dim 14) ──────────────────────
    if is_transit_element(tags) {
        #[allow(unused_assignments)]
        {
            is_transit = true;
        }
        match tags.get("railway").map(String::as_str) {
            Some("subway_entrance") => counts.subway_entrances += 1,
            Some("station") => {
                if tags.get("station").map(String::as_str) == Some("subway") {
                    counts.subway_entrances += 1;
                } else {
                    counts.rail_stations += 1;
                }
            }
            Some("tram_stop") | Some("tram_station") => counts.tram_stops += 1,
            Some("halt") => counts.rail_stations += 1,
            _ => {}
        }
        if tags.get("highway").map(String::as_str) == Some("bus_stop") {
            counts.bus_stops += 1;
        }
        // public_transport=platform not double-counted with above
        return (false, true, false);
    }

    // ── Amenity ──────────────────────────────────────────────────────────────
    if let Some(amenity) = tags.get("amenity").map(String::as_str) {
        is_poi = true;
        match amenity {
            "restaurant" => counts.restaurant += 1,
            "cafe" => counts.cafe += 1,
            "bar" | "pub" => counts.bar += 1,
            "fast_food" | "food_court" => counts.fast_food += 1,
            "museum" => counts.museum += 1,
            "theatre" => counts.theatre += 1,
            "library" => counts.library += 1,
            "arts_centre" => counts.gallery += 1,
            "cinema" => counts.cinema += 1,
            "nightclub" => counts.nightclub += 1,
            "atm" => counts.atm += 1,
            "spa" => counts.spa += 1,
            "marketplace" => counts.marketplace += 1,
            "bus_station" => counts.bus_station += 1,
            _ => { is_poi = false; }
        }
    }

    // ── Leisure ──────────────────────────────────────────────────────────────
    if let Some(leisure) = tags.get("leisure").map(String::as_str) {
        is_poi = true;
        match leisure {
            "park" => counts.park += 1,
            "garden" => counts.garden += 1,
            "sports_centre" => counts.sports_centre += 1,
            "fitness_centre" | "gym" | "swimming_pool" => counts.gym += 1,
            _ => { is_poi = false; }
        }
    }

    // ── Shop ─────────────────────────────────────────────────────────────────
    if let Some(shop) = tags.get("shop").map(String::as_str) {
        is_poi = true;
        match shop {
            "supermarket" | "grocery" => counts.supermarket += 1,
            "mall" | "department_store" | "general" => counts.mall += 1,
            "hairdresser" | "barber" => counts.hairdresser += 1,
            "beauty" | "cosmetics" => counts.beauty += 1,
            _ => counts.shop_generic += 1,
        }
    }

    // ── Tourism ──────────────────────────────────────────────────────────────
    if let Some(tourism) = tags.get("tourism").map(String::as_str) {
        is_poi = true;
        match tourism {
            "museum" => counts.museum += 1,
            "gallery" | "art_gallery" => counts.gallery += 1,
            _ => { is_poi = false; }
        }
    }

    (is_poi, is_transit, is_water)
}

// ─────────────────────────────────────────────────────────────────────────────
// Main fetch functions
// ─────────────────────────────────────────────────────────────────────────────

/// Fetch POI + transit + water proximity from OSM Overpass API in a single query.
///
/// Data source: OpenStreetMap via Overpass API
/// License: ODbL 1.0 — attribution required
#[allow(dead_code)]
pub async fn fetch_poi_data(
    client: &reqwest::Client,
    lat: f64,
    lon: f64,
    population: i64,
    overpass_url: &str,
) -> Result<PoiCounts> {
    let radius_m = poi_radius_meters(population);
    let radius_km = radius_m as f64 / 1000.0;

    let query = build_combined_query(lat, lon, radius_m);

    let response = client
        .post(overpass_url)
        .form(&[("data", &query)])
        .timeout(std::time::Duration::from_secs(120))
        .send()
        .await
        .map_err(|e| anyhow!("Overpass request failed: {}", e))?;

    if !response.status().is_success() {
        return Err(anyhow!("Overpass API error: HTTP {}", response.status()));
    }

    let body = response.bytes().await.map_err(|e| anyhow!("Failed to read response body: {}", e))?;
    let data: OverpassResponse = serde_json::from_slice(body.as_ref())
        .map_err(|e| anyhow!("Overpass JSON parse failed: {}", e))?;

    let mut counts = PoiCounts {
        radius_km,
        ..Default::default()
    };

    let mut total_poi = 0u32;
    let mut water_candidates: Vec<(f64, f64)> = Vec::new();

    for element in &data.elements {
        let Some(tags) = &element.tags else { continue };

        let (el_lat, el_lon) = if let Some(c) = &element.center {
            (c.lat, c.lon)
        } else if let (Some(la), Some(lo)) = (element.lat, element.lon) {
            (la, lo)
        } else {
            continue;
        };

        let (is_poi, _is_transit, is_water) = parse_element_tags(tags, &mut counts);

        if is_poi {
            total_poi += 1;
        }

        if is_water {
            water_candidates.push((el_lat, el_lon));
        }
    }

    counts.total_poi = total_poi;

    // Find nearest water body
    counts.nearest_water_km = water_candidates
        .iter()
        .map(|&(wlat, wlon)| haversine_km(lat, lon, wlat, wlon))
        .reduce(f64::min);

    debug!(
        "POI fetch: total={}, transit=subway{}+rail{}+tram{}+bus{}, water={:?}km",
        counts.total_poi,
        counts.subway_entrances,
        counts.rail_stations,
        counts.tram_stops,
        counts.bus_stops,
        counts.nearest_water_km.map(|d| format!("{:.1}", d))
    );

    Ok(counts)
}

// ─────────────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────────────

/// Haversine great-circle distance in kilometers.
pub fn haversine_km(lat1: f64, lon1: f64, lat2: f64, lon2: f64) -> f64 {
    const R: f64 = 6371.0; // Earth radius km
    let dlat = (lat2 - lat1).to_radians();
    let dlon = (lon2 - lon1).to_radians();
    let a = (dlat / 2.0).sin().powi(2)
        + lat1.to_radians().cos() * lat2.to_radians().cos() * (dlon / 2.0).sin().powi(2);
    2.0 * R * a.sqrt().atan2((1.0 - a).sqrt())
}

/// Extract 0-based month index from "YYYY-MM-DD" string.
#[allow(dead_code)]
fn parse_month_index(date: &str) -> Option<usize> {
    // date is "YYYY-MM-DD", month is at bytes 5..7
    let month_str = date.get(5..7)?;
    let month: u32 = month_str.parse().ok()?;
    if (1..=12).contains(&month) {
        Some((month - 1) as usize)
    } else {
        None
    }
}
