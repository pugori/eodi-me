//! Core domain types for city-level data collection.
//!
//! These types are shared across the database, stages, pipeline, and
//! command-handler layers.  Keeping them in a single module prevents circular
//! dependencies and makes the data contract explicit.

/// Minimal city record parsed directly from `cities15000.txt` (GeoNames TSV).
///
/// This is the raw input type for Stage 1 — no API data yet.
#[derive(Debug, Clone)]
pub struct CityBasic {
    pub geoname_id:   i64,
    pub name:         String,
    pub ascii_name:   String,
    pub latitude:     f64,
    pub longitude:    f64,
    pub country_code: String,
    pub population:   i64,
    pub timezone:     String,
}

/// Stage 1 result: `CityBasic` enriched with the REST Countries API response.
///
/// `country_info` is the raw JSON string from the REST Countries v3 API.
/// It is stored as-is in the DB and decoded lazily by downstream consumers.
#[derive(Debug)]
pub struct CityData {
    pub basic:        CityBasic,
    /// Raw JSON from `https://restcountries.com/v3.1/alpha/{code}`,
    /// or `None` if the request failed or the country code is unknown.
    pub country_info: Option<String>,
    pub collected_at: chrono::DateTime<chrono::Utc>,
}

impl CityData {
    /// Returns `true` when the minimum Stage-1 requirement is satisfied.
    ///
    /// Climate and POI data are fetched in Stage 2 — their absence here is
    /// expected and does *not* make a city invalid at Stage-1 level.
    pub fn is_valid(&self) -> bool {
        self.country_info.is_some()
    }
}
