//! H3 hexagonal grid collector with Max Areal Overlap admin-boundary tagging.
//!
//! # Pipeline (new — boundary-first approach)
//! 1. Admin boundaries are pre-downloaded per country by `boundary.rs` and
//!    stored in the DB + in-memory `BoundaryIndex` (R-tree).
//! 2. For each city, generate H3 Res-8 hexagons covering the urban radius.
//! 3. For each hexagon, look up the boundary with maximum areal overlap
//!    **locally** (no network round-trip).
//! 4. Collect POI counts inside each hexagon via Overpass (500m radius).
//! 5. Filter: discard hexagons with total_poi < MIN_POI_THRESHOLD.
//! 6. Save to `hexagons` table — one row per valid hexagon.
//!
//! # H3 specifics
//! - Resolution 8  →  cell side ~461m, area 0.737 km²
//! - 성수동 (2.3 km²) ≈ 3 hexagons; Le Marais ≈ 2; Shimokitazawa ≈ 2
//!
//! # No-gap guarantee
//! Multi-level cascade in `BoundaryIndex::assign_hexagon()` ensures every
//! hexagon gets a label.  Ocean/uninhabited hexagons are filtered by the POI
//! threshold before they ever reach the boundary assignment step.
//!
//! # Data licenses
//! OpenStreetMap via Overpass API: ODbL 1.0

use anyhow::{anyhow, Result};
use h3o::{CellIndex, LatLng, Resolution};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tracing::{debug, warn};

use crate::boundary::{BoundaryIndex, h3_to_polygon};
use crate::poi::{haversine_km, PoiCounts};

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/// H3 resolution for neighbourhood-level vibe matching.
/// Res 8 ≈ 0.737 km² side length 461 m — equivalent to Korean 행정동.
pub const HEX_RESOLUTION: Resolution = Resolution::Eight;

/// Minimum POI count per hexagon to be included in the index.
/// Hexagons with <20 POIs are rural/uninhabited → filtered out.
pub const MIN_POI_THRESHOLD: u32 = 20;

/// POI query radius for a single hexagon centroid (metres).
/// H3 Res-8 cell edge length ≈ 461 m → 500 m covers the full cell.
pub const HEX_POI_RADIUS_M: u32 = 500;

// ─────────────────────────────────────────────────────────────────────────────
// Data structures
// ─────────────────────────────────────────────────────────────────────────────

/// One hexagon row as stored in the `hexagons` DB table.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HexRecord {
    /// H3 cell index (uint64 serialised as text for SQLite).
    pub h3_index: u64,
    /// Centroid latitude.
    pub lat: f64,
    /// Centroid longitude.
    pub lon: f64,

    /// Name of the administrative area this hexagon belongs to.
    /// Assigned via Maximum Areal Overlap from the local BoundaryIndex.
    pub admin_name: String,
    /// OSM admin_level tag of the matched polygon (higher = more specific).
    pub admin_level: u8,
    /// Overlap ratio 0.0–1.0 (1.0 = hexagon fully inside the boundary).
    pub overlap_ratio: f64,

    /// GeoNames geoname_id of the parent city used to generate this hexagon.
    pub parent_city_id: i64,
    /// Parent city name (for display & fallback).
    pub parent_city_name: String,

    /// Raw POI counts collected at this hexagon centroid.
    pub poi: PoiCounts,

    /// Whether this hexagon passes the MIN_POI_THRESHOLD filter.
    pub is_valid: bool,
}

// ─────────────────────────────────────────────────────────────────────────────
// H3 hexagon generation
// ─────────────────────────────────────────────────────────────────────────────

/// Urban radius used to generate hexagons around a city centre.
/// Mirrors the POI query radius used for the city-level collection.
fn urban_radius_km(population: i64) -> f64 {
    match population {
        0..=50_000 => 3.0,
        50_001..=500_000 => 5.0,
        _ => 8.0,
    }
}

/// Generate all H3 Res-8 cell indices whose centroid falls within
/// `radius_km` of `(lat, lon)`.  Uses `gridDisk` (k-ring) approximation:
/// we compute the k that covers the radius, then discard cells whose
/// centroid is further than `radius_km`.
pub fn generate_city_hexagons(lat: f64, lon: f64, population: i64) -> Vec<CellIndex> {
    let radius_km = urban_radius_km(population);

    // H3 Res-8 average edge length ≈ 0.4614 km.
    // k-ring radius in cells: k = ceil(radius_km / edge_length) + 1 (safety margin)
    let edge_km: f64 = 0.4614;
    let k = ((radius_km / edge_km).ceil() as u32 + 1).max(1);

    let Ok(ll) = LatLng::new(lat, lon) else {
        warn!("Invalid lat/lon ({}, {}), skipping", lat, lon);
        return Vec::new();
    };
    let center_cell = ll.to_cell(HEX_RESOLUTION);

    // GridDisk returns all cells within k rings from center.
    let disk: Vec<CellIndex> = center_cell.grid_disk::<Vec<_>>(k);

    // Filter to only cells whose centroid is within the urban radius.
    disk.into_iter()
        .filter(|cell| {
            let c: LatLng = (*cell).into();
            haversine_km(lat, lon, c.lat(), c.lng()) <= radius_km
        })
        .collect()
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-hexagon POI query
// ─────────────────────────────────────────────────────────────────────────────

/// Build an Overpass QL query for POI within `HEX_POI_RADIUS_M` of a hex centroid.
/// Identical categories as the city-level query, smaller radius (500m).
fn build_hex_poi_query(lat: f64, lon: f64) -> String {
    let r = HEX_POI_RADIUS_M;
    format!(
        r#"[out:json][timeout:60];
(
  node["amenity"~"^(restaurant|cafe|bar|pub|fast_food|food_court)$"](around:{r},{lat},{lon});
  node["amenity"~"^(museum|theatre|library|arts_centre|cinema|nightclub|spa|atm|marketplace)$"](around:{r},{lat},{lon});
  node["amenity"="bus_station"](around:{r},{lat},{lon});
  node["leisure"~"^(park|garden|sports_centre|fitness_centre|swimming_pool)$"](around:{r},{lat},{lon});
  way["leisure"~"^(park|garden|sports_centre)$"](around:{r},{lat},{lon});
  node["shop"~"^(supermarket|mall|department_store|general|convenience|hairdresser|beauty|barber)$"](around:{r},{lat},{lon});
  way["shop"~"^(mall|supermarket|department_store)$"](around:{r},{lat},{lon});
  node["tourism"~"^(museum|gallery|artwork)$"](around:{r},{lat},{lon});
  node["highway"="bus_stop"](around:{r},{lat},{lon});
  node["railway"~"^(station|subway_entrance|tram_stop|halt)$"](around:{r},{lat},{lon});
  node["public_transport"~"^(stop_position|platform)$"](around:{r},{lat},{lon});
  way["natural"~"^(water|coastline|bay)$"](around:5000,{lat},{lon});
  way["waterway"~"^(river|canal)$"](around:5000,{lat},{lon});
);
out center tags;"#,
        r = r,
        lat = lat,
        lon = lon,
    )
}

/// Collect POI data for a single hexagon centroid.
/// Returns `None` if the Overpass fetch fails (the caller skips this cell).
pub async fn fetch_hex_poi(
    client: &reqwest::Client,
    lat: f64,
    lon: f64,
    overpass_url: &str,
) -> Result<PoiCounts> {
    use crate::poi::PoiCounts;

    let query = build_hex_poi_query(lat, lon);

    let response = client
        .post(overpass_url)
        .form(&[("data", &query)])
        .timeout(std::time::Duration::from_secs(90))
        .send()
        .await
        .map_err(|e| anyhow!("Overpass hex POI request failed: {}", e))?;

    if !response.status().is_success() {
        return Err(anyhow!("Overpass API error: HTTP {}", response.status()));
    }

    let body = response.bytes().await?;

    #[derive(Deserialize)]
    struct OvResp {
        elements: Vec<OvEl>,
    }
    #[derive(Deserialize)]
    struct OvEl {
        #[serde(rename = "type")]
        #[allow(dead_code)]
        etype: String,
        lat: Option<f64>,
        lon: Option<f64>,
        center: Option<OvCenter>,
        tags: Option<HashMap<String, String>>,
    }
    #[derive(Deserialize, Clone)]
    struct OvCenter { lat: f64, lon: f64 }

    let data: OvResp = serde_json::from_slice(&body)
        .map_err(|e| anyhow!("Overpass JSON parse failed: {}", e))?;

    let radius_km = HEX_POI_RADIUS_M as f64 / 1000.0;
    let mut counts = PoiCounts { radius_km, ..Default::default() };
    let mut total_poi = 0u32;
    let mut water_candidates: Vec<(f64, f64)> = Vec::new();

    for el in &data.elements {
        let Some(tags) = &el.tags else { continue };
        let (el_lat, el_lon) = if let Some(c) = &el.center {
            (c.lat, c.lon)
        } else if let (Some(la), Some(lo)) = (el.lat, el.lon) {
            (la, lo)
        } else {
            continue
        };

        // Reuse the same tag-parsing logic from poi.rs via a local closure
        let (is_poi, _transit, is_water) = parse_hex_tags(tags, &mut counts);
        if is_poi { total_poi += 1; }
        if is_water { water_candidates.push((el_lat, el_lon)); }
    }

    counts.total_poi = total_poi;
    counts.nearest_water_km = water_candidates
        .iter()
        .map(|&(wl, wn)| crate::poi::haversine_km(lat, lon, wl, wn))
        .reduce(f64::min);

    Ok(counts)
}

/// Parse OSM tags for hexagon-level POI collection.
/// Mirrors `parse_element_tags` from poi.rs — kept local to avoid
/// coupling the module interface.
fn parse_hex_tags(
    tags: &HashMap<String, String>,
    counts: &mut PoiCounts,
) -> (bool, bool, bool) {
    // ── Water ────────────────────────────────────────────────────────────────
    let is_water = matches!(
        tags.get("natural").map(String::as_str),
        Some("water") | Some("coastline") | Some("bay")
    ) || matches!(
        tags.get("waterway").map(String::as_str),
        Some("river") | Some("canal")
    );
    if is_water {
        return (false, false, true);
    }

    // ── Transit ──────────────────────────────────────────────────────────────
    let is_transit = tags.contains_key("railway")
        || tags.get("highway").map(String::as_str) == Some("bus_stop")
        || tags.contains_key("public_transport");
    if is_transit {
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
        return (false, true, false);
    }

    // ── POI ──────────────────────────────────────────────────────────────────
    let mut is_poi = false;

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
    if let Some(tourism) = tags.get("tourism").map(String::as_str) {
        is_poi = true;
        match tourism {
            "museum" => counts.museum += 1,
            "gallery" | "art_gallery" => counts.gallery += 1,
            _ => { is_poi = false; }
        }
    }

    (is_poi, false, false)
}

// ─────────────────────────────────────────────────────────────────────────────
// High-level: collect all hexagons for a city
// ─────────────────────────────────────────────────────────────────────────────

/// Process a single city using a **single batch Overpass request** for all hexagons.
///
/// Instead of one Overpass request per hexagon (~127 for a small city), this
/// function:
/// 1. Computes the bounding box of all hex centroids.
/// 2. Makes ONE Overpass bbox query covering the entire city area.
/// 3. Assigns each returned POI/transit/water element to every hex centroid
///    within the appropriate radius (500 m for POI, 5 km for water).
/// 4. Assigns admin boundaries locally (no network) via `boundary_index`.
///
/// This gives a ~100× speedup over the per-hexagon approach while producing
/// identical results.
///
/// # No-gap guarantee
/// Every hexagon receives an admin label:
///   1. BoundaryIndex cascade (level 10 → 8 → 6 → 4 → 2)
///   2. Fallback: parent city name with admin_level = 0
#[allow(clippy::too_many_arguments)]
pub async fn collect_city_hexagons(
    client: &reqwest::Client,
    city_id: i64,
    city_name: &str,
    lat: f64,
    lon: f64,
    population: i64,
    overpass_url: &str,
    boundary_index: &BoundaryIndex,
) -> Vec<HexRecord> {
    let cells = generate_city_hexagons(lat, lon, population);
    if cells.is_empty() {
        return vec![];
    }

    // Compute centroids for all cells.
    let centroids: Vec<(CellIndex, f64, f64)> = cells
        .iter()
        .map(|&cell| {
            let c: LatLng = cell.into();
            (cell, c.lat(), c.lng())
        })
        .collect();

    // ONE batch Overpass request for the entire city bounding box.
    let poi_map = match fetch_city_poi_batch(client, &centroids, overpass_url).await {
        Ok(m) => m,
        Err(e) => {
            warn!("Batch POI fetch failed for {}: {}", city_name, e);
            return vec![];
        }
    };

    let mut records = Vec::with_capacity(centroids.len());
    for (cell, clat, clon) in centroids {
        let poi = poi_map
            .get(&u64::from(cell))
            .cloned()
            .unwrap_or(PoiCounts { radius_km: HEX_POI_RADIUS_M as f64 / 1000.0, ..Default::default() });

        let is_valid = poi.total_poi >= MIN_POI_THRESHOLD;

        // Admin boundary — local lookup, zero network.
        let hex_poly = h3_to_polygon(cell);
        let assignment = boundary_index.assign_hexagon(&hex_poly, city_name);

        records.push(HexRecord {
            h3_index: u64::from(cell),
            lat: clat,
            lon: clon,
            admin_name: assignment.name,
            admin_level: assignment.admin_level,
            overlap_ratio: assignment.overlap_ratio,
            parent_city_id: city_id,
            parent_city_name: city_name.to_string(),
            poi,
            is_valid,
        });
    }

    records
}

// ─────────────────────────────────────────────────────────────────────────────
// Batch Overpass fetch — ONE request per city instead of one per hexagon
// ─────────────────────────────────────────────────────────────────────────────

/// Fetch all POI/transit/water elements for a set of hex centroids in a single
/// Overpass bounding-box query, then assign each element to every centroid
/// within the appropriate radius (500 m for POI, 5 km for water).
///
/// Returns a map from H3 cell index (u64) to `PoiCounts`.
async fn fetch_city_poi_batch(
    client: &reqwest::Client,
    centroids: &[(CellIndex, f64, f64)],
    overpass_url: &str,
) -> Result<HashMap<u64, PoiCounts>> {
    use crate::poi::PoiCounts;

    // ── Bounding box with water-search buffer (5 km). ───────────────────────
    // 1° latitude ≈ 111 km; longitude degrees vary but we use the same factor
    // as a conservative approximation (slightly larger bbox = fine).
    let water_buf_deg = 5_000.0_f64 / 111_000.0;

    let min_lat = centroids.iter().map(|&(_, la, _)| la).fold(f64::INFINITY, f64::min) - water_buf_deg;
    let max_lat = centroids.iter().map(|&(_, la, _)| la).fold(f64::NEG_INFINITY, f64::max) + water_buf_deg;
    let min_lon = centroids.iter().map(|&(_, _, lo)| lo).fold(f64::INFINITY, f64::min) - water_buf_deg;
    let max_lon = centroids.iter().map(|&(_, _, lo)| lo).fold(f64::NEG_INFINITY, f64::max) + water_buf_deg;

    let query = format!(
        r#"[out:json][timeout:120][bbox:{s},{w},{n},{e}];
(
  node["amenity"~"^(restaurant|cafe|bar|pub|fast_food|food_court)$"];
  node["amenity"~"^(museum|theatre|library|arts_centre|cinema|nightclub|spa|atm|marketplace)$"];
  node["amenity"="bus_station"];
  node["leisure"~"^(park|garden|sports_centre|fitness_centre|swimming_pool)$"];
  way["leisure"~"^(park|garden|sports_centre)$"];
  node["shop"~"^(supermarket|mall|department_store|general|convenience|hairdresser|beauty|barber)$"];
  way["shop"~"^(mall|supermarket|department_store)$"];
  node["tourism"~"^(museum|gallery|artwork)$"];
  node["highway"="bus_stop"];
  node["railway"~"^(station|subway_entrance|tram_stop|halt)$"];
  node["public_transport"~"^(stop_position|platform)$"];
  way["natural"~"^(water|coastline|bay)$"];
  way["waterway"~"^(river|canal)$"];
);
out center tags;"#,
        s = min_lat, w = min_lon, n = max_lat, e = max_lon,
    );

    let response = {
        // Retry with exponential backoff on connection errors / 429 responses.
        let mut last_err = anyhow!("no attempts");
        let mut resp = None;
        for attempt in 0u32..4 {
            if attempt > 0 {
                let delay_ms = 2_000u64 * (1 << (attempt - 1)); // 2s, 4s, 8s
                tokio::time::sleep(std::time::Duration::from_millis(delay_ms)).await;
                debug!("Overpass retry {}/{} after {}ms", attempt, 3, delay_ms);
            }
            match client
                .post(overpass_url)
                .form(&[("data", &query)])
                .timeout(std::time::Duration::from_secs(120))
                .send()
                .await
            {
                Ok(r) if r.status().as_u16() == 429 => {
                    last_err = anyhow!("Rate limited (429)");
                }
                Ok(r) => { resp = Some(r); break; }
                Err(e) => { last_err = anyhow!("{}", e); }
            }
        }
        match resp {
            Some(r) => r,
            None => return Err(anyhow!("Overpass batch request failed: {}", last_err)),
        }
    };

    if !response.status().is_success() {
        return Err(anyhow!("Overpass API error: HTTP {}", response.status()));
    }

    let body = response.bytes().await?;

    #[derive(Deserialize)]
    struct OvResp { elements: Vec<OvEl> }
    #[derive(Deserialize)]
    struct OvEl {
        #[serde(rename = "type")] #[allow(dead_code)] etype: String,
        lat: Option<f64>,
        lon: Option<f64>,
        center: Option<OvCenter>,
        tags: Option<HashMap<String, String>>,
    }
    #[derive(Deserialize, Clone)]
    struct OvCenter { lat: f64, lon: f64 }

    let data: OvResp = serde_json::from_slice(&body)
        .map_err(|e| anyhow!("Overpass JSON parse failed: {}", e))?;

    let poi_radius_km = HEX_POI_RADIUS_M as f64 / 1000.0;
    let water_radius_km = 5.0_f64;

    // Initialise per-hex count maps.
    let mut hex_counts: HashMap<u64, PoiCounts> = centroids
        .iter()
        .map(|&(cell, _, _)| {
            (u64::from(cell), PoiCounts { radius_km: poi_radius_km, ..Default::default() })
        })
        .collect();
    // Water candidates per hex.
    let mut hex_water: HashMap<u64, f64> = HashMap::new(); // hex_id → nearest_water_km

    for el in &data.elements {
        let Some(tags) = &el.tags else { continue };
        let (el_lat, el_lon) = if let Some(c) = &el.center {
            (c.lat, c.lon)
        } else if let (Some(la), Some(lo)) = (el.lat, el.lon) {
            (la, lo)
        } else {
            continue;
        };

        let is_water = matches!(
            tags.get("natural").map(String::as_str),
            Some("water") | Some("coastline") | Some("bay")
        ) || matches!(
            tags.get("waterway").map(String::as_str),
            Some("river") | Some("canal")
        );

        for &(cell, clat, clon) in centroids {
            let dist_km = haversine_km(clat, clon, el_lat, el_lon);
            let hex_id = u64::from(cell);

            if is_water {
                if dist_km <= water_radius_km {
                    let entry = hex_water.entry(hex_id).or_insert(f64::INFINITY);
                    if dist_km < *entry { *entry = dist_km; }
                }
            } else if dist_km <= poi_radius_km {
                // Use a temporary counts struct to reuse parse_hex_tags, then merge.
                let mut tmp = PoiCounts::default();
                let (is_poi, _is_transit, _) = parse_hex_tags(tags, &mut tmp);
                let c = hex_counts.get_mut(&hex_id).unwrap();
                if is_poi || _is_transit {
                    c.restaurant += tmp.restaurant;
                    c.cafe += tmp.cafe;
                    c.bar += tmp.bar;
                    c.fast_food += tmp.fast_food;
                    c.museum += tmp.museum;
                    c.theatre += tmp.theatre;
                    c.library += tmp.library;
                    c.gallery += tmp.gallery;
                    c.park += tmp.park;
                    c.garden += tmp.garden;
                    c.sports_centre += tmp.sports_centre;
                    c.spa += tmp.spa;
                    c.bus_station += tmp.bus_station;
                    c.atm += tmp.atm;
                    c.nightclub += tmp.nightclub;
                    c.cinema += tmp.cinema;
                    c.beauty += tmp.beauty;
                    c.hairdresser += tmp.hairdresser;
                    c.gym += tmp.gym;
                    c.supermarket += tmp.supermarket;
                    c.mall += tmp.mall;
                    c.shop_generic += tmp.shop_generic;
                    c.marketplace += tmp.marketplace;
                    c.subway_entrances += tmp.subway_entrances;
                    c.rail_stations += tmp.rail_stations;
                    c.tram_stops += tmp.tram_stops;
                    c.bus_stops += tmp.bus_stops;
                }
            }
        }
    }

    // Finalise total_poi and water proximity.
    for (&hex_id, c) in hex_counts.iter_mut() {
        c.total_poi = c.restaurant + c.cafe + c.bar + c.fast_food
            + c.museum + c.theatre + c.library + c.gallery
            + c.park + c.garden + c.sports_centre + c.spa
            + c.bus_station + c.atm + c.nightclub + c.cinema
            + c.beauty + c.hairdresser + c.gym
            + c.supermarket + c.mall + c.shop_generic + c.marketplace;
        c.nearest_water_km = hex_water.get(&hex_id).copied().map(|d| if d == f64::INFINITY { None } else { Some(d) }).flatten();
    }

    Ok(hex_counts)
}

// ─────────────────────────────────────────────────────────────────────────────
// Global grid — memory-efficient, city-first approach
// ─────────────────────────────────────────────────────────────────────────────

/// One deduplicated cell in the global H3 Res-8 grid with parent city metadata.
#[derive(Debug, Clone)]
pub struct GlobalHexCell {
    pub h3_index: u64,
    pub cell: CellIndex,
    pub lat: f64,
    pub lon: f64,
    pub parent_city_id: i64,
    pub parent_city_name: String,
    pub country_code: String,
}

/// Generate a deduplicated global H3 Res-8 grid from all cities.
///
/// For each city, all hexagon cells within the urban radius are generated.
/// When two cities overlap, the first city encountered claims the cell.
pub fn generate_global_hex_grid(cities: &[crate::city::CityBasic]) -> Vec<GlobalHexCell> {
    let mut seen: HashMap<u64, GlobalHexCell> =
        HashMap::with_capacity(cities.len() * 20);

    for city in cities {
        for cell in generate_city_hexagons(city.latitude, city.longitude, city.population) {
            let idx = u64::from(cell);
            if seen.contains_key(&idx) {
                continue;
            }
            let centroid: LatLng = cell.into();
            seen.insert(
                idx,
                GlobalHexCell {
                    h3_index: idx,
                    cell,
                    lat: centroid.lat(),
                    lon: centroid.lng(),
                    parent_city_id: city.geoname_id,
                    parent_city_name: city.name.clone(),
                    country_code: city.country_code.clone(),
                },
            );
        }
    }

    seen.into_values().collect()
}

/// Assign boundary data to the global grid, one country at a time to keep
/// peak memory bounded.
///
/// Returns `Vec<HexRecord>` with admin boundary labels from the local
/// `BoundaryIndex` and POI counts from `poi_map` (keyed by H3 cell index).
pub async fn assign_global_hexagons_by_country(
    grid: &[GlobalHexCell],
    poi_map: &HashMap<u64, PoiCounts>,
    db: &crate::database::CityDatabase,
) -> anyhow::Result<Vec<HexRecord>> {
    // Group cells by country for memory-bounded boundary loading.
    let mut by_country: HashMap<String, Vec<usize>> = HashMap::new();
    for (i, cell) in grid.iter().enumerate() {
        by_country
            .entry(cell.country_code.clone())
            .or_default()
            .push(i);
    }

    let mut all_records: Vec<HexRecord> = Vec::with_capacity(grid.len());
    let countries: Vec<String> = by_country.keys().cloned().collect();

    for cc in &countries {
        let indices = &by_country[cc];

        // Load boundary index for this country only — freed at end of iteration.
        let boundary_index = db
            .build_boundary_index_for_countries(&[cc.clone()])
            .await
            .unwrap_or_else(|e| {
                warn!("⚠️  boundary index failed for {}: {}", cc, e);
                crate::boundary::BoundaryIndex::build(vec![])
            });

        for &idx in indices {
            let hex_cell = &grid[idx];
            let hex_poly = h3_to_polygon(hex_cell.cell);
            let assignment =
                boundary_index.assign_hexagon(&hex_poly, &hex_cell.parent_city_name);
            let poi = poi_map
                .get(&hex_cell.h3_index)
                .cloned()
                .unwrap_or_default();
            let is_valid = poi.total_poi >= MIN_POI_THRESHOLD;

            all_records.push(HexRecord {
                h3_index: hex_cell.h3_index,
                lat: hex_cell.lat,
                lon: hex_cell.lon,
                admin_name: assignment.name,
                admin_level: assignment.admin_level,
                overlap_ratio: assignment.overlap_ratio,
                parent_city_id: hex_cell.parent_city_id,
                parent_city_name: hex_cell.parent_city_name.clone(),
                poi,
                is_valid,
            });
        }
        // `boundary_index` dropped here — memory freed.
    }

    Ok(all_records)
}

/// Re-assign admin boundaries for gap hexagons (`admin_level == 0`).
///
/// Uses the provided `boundary_index` (pre-built for the relevant countries)
/// to re-run Maximum Areal Overlap on each gap hexagon.
///
/// Returns the number of hexagons that received a proper admin label.
pub fn reassign_admin_for_gaps(
    hexagons: &mut Vec<HexRecord>,
    boundary_index: &BoundaryIndex,
) -> usize {
    let mut fixed = 0usize;
    for hex in hexagons.iter_mut() {
        if hex.admin_level > 0 {
            continue;
        }
        let Ok(cell) = CellIndex::try_from(hex.h3_index) else {
            continue;
        };
        let hex_poly = h3_to_polygon(cell);
        let assignment = boundary_index.assign_hexagon(&hex_poly, &hex.parent_city_name);
        if assignment.admin_level > 0 {
            hex.admin_name = assignment.name;
            hex.admin_level = assignment.admin_level;
            hex.overlap_ratio = assignment.overlap_ratio;
            fixed += 1;
        }
    }
    fixed
}
