//! Geofabrik PBF-based POI extraction — disk-space efficient.
//!
//! Strategy
//! --------
//! 1. Group cities by the **smallest** Geofabrik file that covers them.
//!    All regions are mapped at country level (Africa, Asia, South America)
//!    or sub-region level (US) to keep individual file sizes ≤ ~350 MB.
//!    Europe was already per-country; now Africa/Asia/South America match.
//! 2. For each group: download PBF → scan with rstar R-tree → delete PBF.
//!    Max disk usage ≈ largest single file (~350 MB South Africa).
//! 3. Climate data (NASA POWER) is fetched via HTTP in parallel, unchanged.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use anyhow::{Context, Result};
use osmpbf::{ElementReader, Element};
use rstar::{RTree, RTreeObject, AABB};
use tracing::{info, warn};

use crate::poi::{parse_element_tags, poi_radius_meters, PoiCounts};

fn parse_env_u32(name: &str) -> Option<u32> {
    std::env::var(name).ok()?.trim().parse::<u32>().ok()
}

fn auto_aria2_split(total_bytes: u64) -> u32 {
    // Conservative defaults that work well for large Geofabrik PBF files.
    // Users can override with EODI_ARIA2_SPLIT.
    if let Some(v) = parse_env_u32("EODI_ARIA2_SPLIT") {
        return v.clamp(1, 32);
    }
    match total_bytes {
        0 => 12,
        1..=512_000_000 => 6,               // <= ~512 MB
        512_000_001..=2_000_000_000 => 10,  // <= ~2 GB
        2_000_000_001..=6_000_000_000 => 16, // <= ~6 GB
        _ => 20,
    }
}

fn auto_aria2_min_split_size(total_bytes: u64) -> &'static str {
    if total_bytes >= 6_000_000_000 { "8M" }
    else if total_bytes >= 2_000_000_000 { "4M" }
    else { "2M" }
}

async fn try_download_with_aria2(url: &str, partial: &Path, total_bytes: u64) -> Result<bool> {
    use tokio::process::Command;

    let out_name = match partial.file_name().and_then(|n| n.to_str()) {
        Some(n) => n,
        None => return Ok(false),
    };
    let out_dir = match partial.parent().and_then(|p| p.to_str()) {
        Some(d) => d,
        None => return Ok(false),
    };

    let split = auto_aria2_split(total_bytes);
    let min_split = auto_aria2_min_split_size(total_bytes);
    info!(
        "🚀 aria2 auto-tuning: split={} min-split-size={} (size ~{:.0} MB)",
        split,
        min_split,
        total_bytes as f64 / 1_048_576.0
    );

    let output = Command::new("aria2c")
        .arg("--allow-overwrite=true")
        .arg("--auto-file-renaming=false")
        .arg("--summary-interval=0")
        .arg("--file-allocation=none")
        .arg(format!("--max-connection-per-server={}", split))
        .arg(format!("--split={}", split))
        .arg(format!("--min-split-size={}", min_split))
        .arg("--timeout=60")
        .arg("--max-tries=1")
        .arg("--out").arg(out_name)
        .arg("--dir").arg(out_dir)
        .arg(url)
        .output()
        .await;

    match output {
        Ok(result) if result.status.success() => {
            info!("🚀 aria2c multi-connection download completed");
            Ok(true)
        }
        Ok(result) => {
            let stderr = String::from_utf8_lossy(&result.stderr);
            warn!(
                "⚠️  aria2c failed (exit: {:?}), falling back to reqwest stream: {}",
                result.status.code(),
                stderr.lines().last().unwrap_or("no stderr")
            );
            Ok(false)
        }
        Err(e) => {
            if e.kind() == std::io::ErrorKind::NotFound {
                tracing::debug!("aria2c not found, using built-in downloader");
            } else {
                warn!("⚠️  aria2c launch failed, using built-in downloader: {}", e);
            }
            Ok(false)
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Geofabrik region mapping
// ─────────────────────────────────────────────────────────────────────────────

/// Map ISO alpha-2 country code → `(human label, Geofabrik PBF URL)`.
///
/// * Continents with total size < ~1.5 GB use the continent-level file.
/// * Europe uses per-country files (avoids downloading 28 GB).
/// * North America: Mexico & Canada get country files; USA uses sub-regions
///   (Geofabrik US regions: us-northeast / us-midwest / us-south / us-west).
pub fn geofabrik_region(country_code: &str) -> (&'static str, &'static str) {
    match country_code {
        // ── Africa (per-country — avoids 7+ GB continent file) ───────────
        // Each country file: 1–340 MB.  Max single file ≈ Nigeria ~220 MB,
        // South Africa ~340 MB.  Grouped where Geofabrik only offers combined.
        "DZ" => ("Algeria",          "https://download.geofabrik.de/africa/algeria-latest.osm.pbf"),
        "AO" => ("Angola",           "https://download.geofabrik.de/africa/angola-latest.osm.pbf"),
        "BJ" => ("Benin",            "https://download.geofabrik.de/africa/benin-latest.osm.pbf"),
        "BW" => ("Botswana",         "https://download.geofabrik.de/africa/botswana-latest.osm.pbf"),
        "BF" => ("Burkina-Faso",     "https://download.geofabrik.de/africa/burkina-faso-latest.osm.pbf"),
        "BI" => ("Burundi",          "https://download.geofabrik.de/africa/burundi-latest.osm.pbf"),
        "CM" => ("Cameroon",         "https://download.geofabrik.de/africa/cameroon-latest.osm.pbf"),
        "CV" => ("Cape-Verde",       "https://download.geofabrik.de/africa/cape-verde-latest.osm.pbf"),
        "CF" => ("CAR",              "https://download.geofabrik.de/africa/central-african-republic-latest.osm.pbf"),
        "TD" => ("Chad",             "https://download.geofabrik.de/africa/chad-latest.osm.pbf"),
        "KM" => ("Comoros",          "https://download.geofabrik.de/africa/comoros-latest.osm.pbf"),
        "CD" => ("DR-Congo",         "https://download.geofabrik.de/africa/congo-democratic-republic-latest.osm.pbf"),
        "CG" => ("Congo",            "https://download.geofabrik.de/africa/congo-republic-latest.osm.pbf"),
        "DJ" => ("Djibouti",         "https://download.geofabrik.de/africa/djibouti-latest.osm.pbf"),
        "EG" => ("Egypt",            "https://download.geofabrik.de/africa/egypt-latest.osm.pbf"),
        "GQ" => ("Eq-Guinea",        "https://download.geofabrik.de/africa/equatorial-guinea-latest.osm.pbf"),
        "ER" => ("Eritrea",          "https://download.geofabrik.de/africa/eritrea-latest.osm.pbf"),
        "ET" => ("Ethiopia",         "https://download.geofabrik.de/africa/ethiopia-latest.osm.pbf"),
        "GA" => ("Gabon",            "https://download.geofabrik.de/africa/gabon-latest.osm.pbf"),
        "GH" => ("Ghana",            "https://download.geofabrik.de/africa/ghana-latest.osm.pbf"),
        "GN" => ("Guinea",           "https://download.geofabrik.de/africa/guinea-latest.osm.pbf"),
        "GW" => ("Guinea-Bissau",    "https://download.geofabrik.de/africa/guinea-bissau-latest.osm.pbf"),
        "CI" => ("Ivory-Coast",      "https://download.geofabrik.de/africa/ivory-coast-latest.osm.pbf"),
        "KE" => ("Kenya",            "https://download.geofabrik.de/africa/kenya-latest.osm.pbf"),
        "LR" => ("Liberia",          "https://download.geofabrik.de/africa/liberia-latest.osm.pbf"),
        "LY" => ("Libya",            "https://download.geofabrik.de/africa/libya-latest.osm.pbf"),
        "MG" => ("Madagascar",       "https://download.geofabrik.de/africa/madagascar-latest.osm.pbf"),
        "MW" => ("Malawi",           "https://download.geofabrik.de/africa/malawi-latest.osm.pbf"),
        "ML" => ("Mali",             "https://download.geofabrik.de/africa/mali-latest.osm.pbf"),
        "MR" => ("Mauritania",       "https://download.geofabrik.de/africa/mauritania-latest.osm.pbf"),
        "MU" => ("Mauritius",        "https://download.geofabrik.de/africa/mauritius-latest.osm.pbf"),
        "YT" => ("Mayotte",          "https://download.geofabrik.de/africa/mayotte-latest.osm.pbf"),
        "MA" => ("Morocco",          "https://download.geofabrik.de/africa/morocco-latest.osm.pbf"),
        "MZ" => ("Mozambique",       "https://download.geofabrik.de/africa/mozambique-latest.osm.pbf"),
        "NA" => ("Namibia",          "https://download.geofabrik.de/africa/namibia-latest.osm.pbf"),
        "NE" => ("Niger",            "https://download.geofabrik.de/africa/niger-latest.osm.pbf"),
        "NG" => ("Nigeria",          "https://download.geofabrik.de/africa/nigeria-latest.osm.pbf"),
        "RE" => ("Reunion",          "https://download.geofabrik.de/africa/reunion-latest.osm.pbf"),
        "RW" => ("Rwanda",           "https://download.geofabrik.de/africa/rwanda-latest.osm.pbf"),
        "SH" => ("Saint-Helena",     "https://download.geofabrik.de/africa/saint-helena-ascension-and-tristan-da-cunha-latest.osm.pbf"),
        "ST" => ("Sao-Tome",         "https://download.geofabrik.de/africa/sao-tome-and-principe-latest.osm.pbf"),
        "SC" => ("Seychelles",       "https://download.geofabrik.de/africa/seychelles-latest.osm.pbf"),
        "SL" => ("Sierra-Leone",     "https://download.geofabrik.de/africa/sierra-leone-latest.osm.pbf"),
        "SO" => ("Somalia",          "https://download.geofabrik.de/africa/somalia-latest.osm.pbf"),
        "SS" => ("South-Sudan",      "https://download.geofabrik.de/africa/south-sudan-latest.osm.pbf"),
        "SD" => ("Sudan",            "https://download.geofabrik.de/africa/sudan-latest.osm.pbf"),
        "SZ" => ("Eswatini",         "https://download.geofabrik.de/africa/swaziland-latest.osm.pbf"),
        "TZ" => ("Tanzania",         "https://download.geofabrik.de/africa/tanzania-latest.osm.pbf"),
        "TG" => ("Togo",             "https://download.geofabrik.de/africa/togo-latest.osm.pbf"),
        "TN" => ("Tunisia",          "https://download.geofabrik.de/africa/tunisia-latest.osm.pbf"),
        "UG" => ("Uganda",           "https://download.geofabrik.de/africa/uganda-latest.osm.pbf"),
        "EH" => ("W-Sahara",         "https://download.geofabrik.de/africa/western-sahara-latest.osm.pbf"),
        "ZM" => ("Zambia",           "https://download.geofabrik.de/africa/zambia-latest.osm.pbf"),
        "ZW" => ("Zimbabwe",         "https://download.geofabrik.de/africa/zimbabwe-latest.osm.pbf"),
        // Geofabrik groups these pairs together:
        "SN"|"GM" => ("Senegal-Gambia",    "https://download.geofabrik.de/africa/senegal-and-gambia-latest.osm.pbf"),
        "ZA"|"LS" => ("South-Africa",      "https://download.geofabrik.de/africa/south-africa-and-lesotho-latest.osm.pbf"),

        // ── Antarctica (continent ~10 MB) ─────────────────────────────────
        "AQ"
            => ("Antarctica", "https://download.geofabrik.de/antarctica-latest.osm.pbf"),

        // ── Australia / Oceania (~700 MB continent) ───────────────────────
        // Per-country for the large ones; continent for tiny island states.
        "AU" => ("Australia",   "https://download.geofabrik.de/australia-oceania/australia-latest.osm.pbf"),
        "NZ" => ("New-Zealand", "https://download.geofabrik.de/australia-oceania/new-zealand-latest.osm.pbf"),
        "PG" => ("Papua-NG",    "https://download.geofabrik.de/australia-oceania/papua-new-guinea-latest.osm.pbf"),
        "FJ"|"SB"|"VU"|"WS"|"KI"|"FM"|"TO"|"PW"|"MH"|"NR"|"TV"|"CK"|"NU"|
        "TK"|"AS"|"GU"|"MP"|"PF"|"NC"|"WF"|"PN"|"NF"|"CC"|"CX"|"HM"
            => ("Pacific-Islands", "https://download.geofabrik.de/australia-oceania-latest.osm.pbf"),

        // ── Central America & Caribbean (~70 MB continent) ────────────────
        "BZ"|"CR"|"SV"|"GT"|"HN"|"NI"|"PA"|"HT"|"JM"|"DO"|"CU"|"PR"|"TT"|
        "BB"|"LC"|"VC"|"GD"|"AG"|"DM"|"KN"|"BS"|"TC"|"KY"|"VG"|"VI"|"AW"|
        "BQ"|"CW"|"SX"|"MF"|"GP"|"MQ"|"BL"|"BM"|"AI"|"MS"
            => ("Central-America", "https://download.geofabrik.de/central-america-latest.osm.pbf"),

        // ── South America (per-country — avoids 1.1 GB continent file) ───
        "AR" => ("Argentina",  "https://download.geofabrik.de/south-america/argentina-latest.osm.pbf"),
        "BO" => ("Bolivia",    "https://download.geofabrik.de/south-america/bolivia-latest.osm.pbf"),
        "BR" => ("Brazil",     "https://download.geofabrik.de/south-america/brazil-latest.osm.pbf"),
        "CL" => ("Chile",      "https://download.geofabrik.de/south-america/chile-latest.osm.pbf"),
        "CO" => ("Colombia",   "https://download.geofabrik.de/south-america/colombia-latest.osm.pbf"),
        "EC" => ("Ecuador",    "https://download.geofabrik.de/south-america/ecuador-latest.osm.pbf"),
        "GY" => ("Guyana",     "https://download.geofabrik.de/south-america/guyana-latest.osm.pbf"),
        "PY" => ("Paraguay",   "https://download.geofabrik.de/south-america/paraguay-latest.osm.pbf"),
        "PE" => ("Peru",       "https://download.geofabrik.de/south-america/peru-latest.osm.pbf"),
        "SR" => ("Suriname",   "https://download.geofabrik.de/south-america/suriname-latest.osm.pbf"),
        "UY" => ("Uruguay",    "https://download.geofabrik.de/south-america/uruguay-latest.osm.pbf"),
        "VE" => ("Venezuela",  "https://download.geofabrik.de/south-america/venezuela-latest.osm.pbf"),
        "GF"|"FK"
            => ("South-America-other", "https://download.geofabrik.de/south-america-latest.osm.pbf"),

        // ── Asia (per-country — avoids 1.3 GB continent file) ────────────
        "CN" => ("China",         "https://download.geofabrik.de/asia/china-latest.osm.pbf"),
        "IN" => ("India",         "https://download.geofabrik.de/asia/india-latest.osm.pbf"),
        "ID" => ("Indonesia",     "https://download.geofabrik.de/asia/indonesia-latest.osm.pbf"),
        "JP" => ("Japan",         "https://download.geofabrik.de/asia/japan-latest.osm.pbf"),
        "KR" => ("South-Korea",   "https://download.geofabrik.de/asia/south-korea-latest.osm.pbf"),
        "IR" => ("Iran",          "https://download.geofabrik.de/asia/iran-latest.osm.pbf"),
        "VN" => ("Vietnam",       "https://download.geofabrik.de/asia/vietnam-latest.osm.pbf"),
        "MM" => ("Myanmar",       "https://download.geofabrik.de/asia/myanmar-latest.osm.pbf"),
        "AF" => ("Afghanistan",   "https://download.geofabrik.de/asia/afghanistan-latest.osm.pbf"),
        "AM" => ("Armenia",       "https://download.geofabrik.de/asia/armenia-latest.osm.pbf"),
        "AZ" => ("Azerbaijan",    "https://download.geofabrik.de/asia/azerbaijan-latest.osm.pbf"),
        "BD" => ("Bangladesh",    "https://download.geofabrik.de/asia/bangladesh-latest.osm.pbf"),
        "BT" => ("Bhutan",        "https://download.geofabrik.de/asia/bhutan-latest.osm.pbf"),
        "KH" => ("Cambodia",      "https://download.geofabrik.de/asia/cambodia-latest.osm.pbf"),
        "CY" => ("Cyprus",        "https://download.geofabrik.de/asia/cyprus-latest.osm.pbf"),
        "GE" => ("Georgia",       "https://download.geofabrik.de/asia/georgia-latest.osm.pbf"),
        "IQ" => ("Iraq",          "https://download.geofabrik.de/asia/iraq-latest.osm.pbf"),
        "JO" => ("Jordan",        "https://download.geofabrik.de/asia/jordan-latest.osm.pbf"),
        "KZ" => ("Kazakhstan",    "https://download.geofabrik.de/asia/kazakhstan-latest.osm.pbf"),
        "KG" => ("Kyrgyzstan",    "https://download.geofabrik.de/asia/kyrgyzstan-latest.osm.pbf"),
        "LA" => ("Laos",          "https://download.geofabrik.de/asia/laos-latest.osm.pbf"),
        "LB" => ("Lebanon",       "https://download.geofabrik.de/asia/lebanon-latest.osm.pbf"),
        "MN" => ("Mongolia",      "https://download.geofabrik.de/asia/mongolia-latest.osm.pbf"),
        "NP" => ("Nepal",         "https://download.geofabrik.de/asia/nepal-latest.osm.pbf"),
        "KP" => ("North-Korea",   "https://download.geofabrik.de/asia/north-korea-latest.osm.pbf"),
        "OM" => ("Oman",          "https://download.geofabrik.de/asia/oman-latest.osm.pbf"),
        "PK" => ("Pakistan",      "https://download.geofabrik.de/asia/pakistan-latest.osm.pbf"),
        "PH" => ("Philippines",   "https://download.geofabrik.de/asia/philippines-latest.osm.pbf"),
        "SA" => ("Saudi-Arabia",  "https://download.geofabrik.de/asia/gcc-states-latest.osm.pbf"),
        "LK" => ("Sri-Lanka",     "https://download.geofabrik.de/asia/sri-lanka-latest.osm.pbf"),
        "SY" => ("Syria",         "https://download.geofabrik.de/asia/syria-latest.osm.pbf"),
        "TW" => ("Taiwan",        "https://download.geofabrik.de/asia/taiwan-latest.osm.pbf"),
        "TJ" => ("Tajikistan",    "https://download.geofabrik.de/asia/tajikistan-latest.osm.pbf"),
        "TH" => ("Thailand",      "https://download.geofabrik.de/asia/thailand-latest.osm.pbf"),
        "TL" => ("East-Timor",    "https://download.geofabrik.de/asia/east-timor-latest.osm.pbf"),
        "TM" => ("Turkmenistan",  "https://download.geofabrik.de/asia/turkmenistan-latest.osm.pbf"),
        "UZ" => ("Uzbekistan",    "https://download.geofabrik.de/asia/uzbekistan-latest.osm.pbf"),
        "YE" => ("Yemen",         "https://download.geofabrik.de/asia/yemen-latest.osm.pbf"),
        // Geofabrik groups these:
        "MY"|"SG"|"BN" => ("Malaysia-Singapore", "https://download.geofabrik.de/asia/malaysia-singapore-brunei-latest.osm.pbf"),
        "IL"|"PS"      => ("Israel-Palestine",   "https://download.geofabrik.de/asia/israel-and-palestine-latest.osm.pbf"),
        "BH"|"KW"|"QA"|"AE" => ("GCC-States",   "https://download.geofabrik.de/asia/gcc-states-latest.osm.pbf"),
        "HK"|"MO"      => ("Hong-Kong-Macao",    "https://download.geofabrik.de/asia/hong-kong-latest.osm.pbf"),
        "MV"           => ("Maldives",           "https://download.geofabrik.de/asia/maldives-latest.osm.pbf"),

        // ── European micro-states & territories ───────────────────────────
        // Geofabrik has dedicated files for these self-governing islands:
        "FO" => ("Faroe-Islands", "https://download.geofabrik.de/europe/faroe-islands-latest.osm.pbf"),
        "IM" => ("Isle-of-Man",   "https://download.geofabrik.de/europe/isle-of-man-latest.osm.pbf"),
        // These territories are included in a neighbouring country's file:
        "GI"      => ("Spain-GI",     "https://download.geofabrik.de/europe/spain-latest.osm.pbf"),
        "SM"|"VA" => ("Italy-SM-VA",  "https://download.geofabrik.de/europe/italy-latest.osm.pbf"),
        "JE"|"GG" => ("GB-Channels",  "https://download.geofabrik.de/europe/great-britain-latest.osm.pbf"),
        "AX"      => ("Finland-AX",   "https://download.geofabrik.de/europe/finland-latest.osm.pbf"),
        "SJ"      => ("Norway-SJ",    "https://download.geofabrik.de/europe/norway-latest.osm.pbf"),
        // French overseas territory near Canada:
        "PM"      => ("Canada-PM",    "https://download.geofabrik.de/north-america/canada-latest.osm.pbf"),
        // Remote/uninhabited territories – Antarctica covers them on Geofabrik:
        "TF"|"BV"|"GS"|"IO" => ("Antarctica-remote", "https://download.geofabrik.de/antarctica-latest.osm.pbf"),

        // ── Europe (per country — avoids 28 GB continent file) ────────────
        "AL" => ("Albania",        "https://download.geofabrik.de/europe/albania-latest.osm.pbf"),
        "AD" => ("Andorra",        "https://download.geofabrik.de/europe/andorra-latest.osm.pbf"),
        "AT" => ("Austria",        "https://download.geofabrik.de/europe/austria-latest.osm.pbf"),
        "BY" => ("Belarus",        "https://download.geofabrik.de/europe/belarus-latest.osm.pbf"),
        "BE" => ("Belgium",        "https://download.geofabrik.de/europe/belgium-latest.osm.pbf"),
        "BA" => ("Bosnia",         "https://download.geofabrik.de/europe/bosnia-herzegovina-latest.osm.pbf"),
        "BG" => ("Bulgaria",       "https://download.geofabrik.de/europe/bulgaria-latest.osm.pbf"),
        "HR" => ("Croatia",        "https://download.geofabrik.de/europe/croatia-latest.osm.pbf"),
        "CZ" => ("Czechia",        "https://download.geofabrik.de/europe/czech-republic-latest.osm.pbf"),
        "DK" => ("Denmark",        "https://download.geofabrik.de/europe/denmark-latest.osm.pbf"),
        "EE" => ("Estonia",        "https://download.geofabrik.de/europe/estonia-latest.osm.pbf"),
        "FI" => ("Finland",        "https://download.geofabrik.de/europe/finland-latest.osm.pbf"),
        "FR" => ("France",         "https://download.geofabrik.de/europe/france-latest.osm.pbf"),
        "DE" => ("Germany",        "https://download.geofabrik.de/europe/germany-latest.osm.pbf"),
        "GR" => ("Greece",         "https://download.geofabrik.de/europe/greece-latest.osm.pbf"),
        "HU" => ("Hungary",        "https://download.geofabrik.de/europe/hungary-latest.osm.pbf"),
        "IS" => ("Iceland",        "https://download.geofabrik.de/europe/iceland-latest.osm.pbf"),
        "IE" => ("Ireland",        "https://download.geofabrik.de/europe/ireland-and-northern-ireland-latest.osm.pbf"),
        "IT" => ("Italy",          "https://download.geofabrik.de/europe/italy-latest.osm.pbf"),
        "XK" => ("Kosovo",         "https://download.geofabrik.de/europe/kosovo-latest.osm.pbf"),
        "LV" => ("Latvia",         "https://download.geofabrik.de/europe/latvia-latest.osm.pbf"),
        "LI" => ("Liechtenstein",  "https://download.geofabrik.de/europe/liechtenstein-latest.osm.pbf"),
        "LT" => ("Lithuania",      "https://download.geofabrik.de/europe/lithuania-latest.osm.pbf"),
        "LU" => ("Luxembourg",     "https://download.geofabrik.de/europe/luxembourg-latest.osm.pbf"),
        "MT" => ("Malta",          "https://download.geofabrik.de/europe/malta-latest.osm.pbf"),
        "MD" => ("Moldova",        "https://download.geofabrik.de/europe/moldova-latest.osm.pbf"),
        "MC" => ("Monaco",         "https://download.geofabrik.de/europe/monaco-latest.osm.pbf"),
        "ME" => ("Montenegro",     "https://download.geofabrik.de/europe/montenegro-latest.osm.pbf"),
        "NL" => ("Netherlands",    "https://download.geofabrik.de/europe/netherlands-latest.osm.pbf"),
        "MK" => ("N.Macedonia",    "https://download.geofabrik.de/europe/macedonia-latest.osm.pbf"),
        "NO" => ("Norway",         "https://download.geofabrik.de/europe/norway-latest.osm.pbf"),
        "PL" => ("Poland",         "https://download.geofabrik.de/europe/poland-latest.osm.pbf"),
        "PT" => ("Portugal",       "https://download.geofabrik.de/europe/portugal-latest.osm.pbf"),
        "RO" => ("Romania",        "https://download.geofabrik.de/europe/romania-latest.osm.pbf"),
        // Russia currently lives at Geofabrik root (not under /europe).
        "RU" => ("Russia",         "https://download.geofabrik.de/russia-latest.osm.pbf"),
        "RS" => ("Serbia",         "https://download.geofabrik.de/europe/serbia-latest.osm.pbf"),
        "SK" => ("Slovakia",       "https://download.geofabrik.de/europe/slovakia-latest.osm.pbf"),
        "SI" => ("Slovenia",       "https://download.geofabrik.de/europe/slovenia-latest.osm.pbf"),
        "ES" => ("Spain",          "https://download.geofabrik.de/europe/spain-latest.osm.pbf"),
        "SE" => ("Sweden",         "https://download.geofabrik.de/europe/sweden-latest.osm.pbf"),
        "CH" => ("Switzerland",    "https://download.geofabrik.de/europe/switzerland-latest.osm.pbf"),
        "TR" => ("Turkey",         "https://download.geofabrik.de/europe/turkey-latest.osm.pbf"),
        "UA" => ("Ukraine",        "https://download.geofabrik.de/europe/ukraine-latest.osm.pbf"),
        "GB" => ("Great-Britain",  "https://download.geofabrik.de/europe/great-britain-latest.osm.pbf"),

        // ── North America ─────────────────────────────────────────────────
        "CA" => ("Canada",  "https://download.geofabrik.de/north-america/canada-latest.osm.pbf"),
        "MX" => ("Mexico",  "https://download.geofabrik.de/north-america/mexico-latest.osm.pbf"),
        "GL" => ("Greenland","https://download.geofabrik.de/north-america/greenland-latest.osm.pbf"),
        // US: assigned to Geofabrik sub-region files by lat/lon bounding box.
        // The actual URL is computed in `us_subregion_url` below.
        "US" => ("US", "us_subregion_placeholder"),

        // ── Fallback: no mapping — skip rather than download planet (~80 GB) ──
        // group_by_region() will warn and omit these cities.
        _ => ("Unknown", "pbf://unmapped"),
    }
}

/// Assign a US city (lat, lon) → Geofabrik sub-region URL.
/// Non-contiguous states (AK, HI) and territories get their own files;
/// the contiguous 48 states are split into Geofabrik's four sub-regions.
pub fn us_subregion_url(lat: f64, lon: f64) -> (&'static str, &'static str) {
    // Alaska: latitude above 54° N (the Alaska Panhandle starts at ~54.5 N).
    if lat > 54.0 {
        return ("US-Alaska", "https://download.geofabrik.de/north-america/us/alaska-latest.osm.pbf");
    }
    // Hawaii: longitude west of −150° (~154–160 W, lat 18–22 N).
    if lon < -150.0 {
        return ("US-Hawaii", "https://download.geofabrik.de/north-america/us/hawaii-latest.osm.pbf");
    }
    // US territories (Puerto Rico lat ~18, Virgin Islands lat ~18, Guam lat ~13 …)
    // fall back to the full US file — they are tiny and infrequent.
    if lat < 24.0 {
        return ("US-Territories", "https://download.geofabrik.de/north-america/us-latest.osm.pbf");
    }
    // Contiguous 48 states — Geofabrik four-region split:
    //   northeast: roughly lon ≥ −80 (ME/NH/VT/MA/RI/CT/NY/NJ/PA/DE/MD/DC/WV/VA)
    //   midwest:   lon −104 to −80, lat ≥ 36 (OH/MI/IN/WI/IL/MN/IA/MO/ND/SD/NE/KS)
    //   south:     lat < 36 (NC/SC/GA/FL/AL/MS/LA/AR/TX/OK/TN/KY/…)
    //   west:      lon < −104 (MT/ID/WY/CO/NM/AZ/UT/NV/CA/OR/WA)
    if lon >= -80.0 {
        ("US-Northeast", "https://download.geofabrik.de/north-america/us-northeast-latest.osm.pbf")
    } else if lon >= -104.0 && lat >= 36.0 {
        ("US-Midwest", "https://download.geofabrik.de/north-america/us-midwest-latest.osm.pbf")
    } else if lat < 36.0 {
        ("US-South", "https://download.geofabrik.de/north-america/us-south-latest.osm.pbf")
    } else {
        ("US-West", "https://download.geofabrik.de/north-america/us-west-latest.osm.pbf")
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// City bounding box (for rstar R-tree lookup)
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Clone)]
pub struct CityRect {
    pub geoname_id: i64,
    pub center_lat: f64,
    pub center_lon: f64,
    pub radius_km:  f64,
    #[allow(dead_code)]   // used for region-batch sort heuristics
    pub population: i64,
    // Precomputed bbox in degrees
    min_lat: f64,
    max_lat: f64,
    min_lon: f64,
    max_lon: f64,
}

impl CityRect {
    pub fn new(geoname_id: i64, lat: f64, lon: f64, population: i64) -> Self {
        let r_m   = poi_radius_meters(population) as f64;
        let r_km  = r_m / 1000.0;
        // 1° lat ≈ 111_320 m; 1° lon ≈ 111_320 m × cos(lat)
        let d_lat = r_m / 111_320.0;
        let d_lon = r_m / (111_320.0 * lat.to_radians().cos().abs().max(0.001));
        Self {
            geoname_id,
            center_lat: lat,
            center_lon: lon,
            radius_km: r_km,
            population,
            min_lat: lat - d_lat,
            max_lat: lat + d_lat,
            min_lon: lon - d_lon,
            max_lon: lon + d_lon,
        }
    }

    /// Water proximity search uses 50 km radius, not the POI radius.
    pub fn water_bbox_deg(&self) -> (f64, f64, f64, f64) {
        let r_m   = 50_000.0_f64;
        let lat   = self.center_lat;
        let d_lat = r_m / 111_320.0;
        let d_lon = r_m / (111_320.0 * lat.to_radians().cos().abs().max(0.001));
        (lat - d_lat, lat + d_lat, self.center_lon - d_lon, self.center_lon + d_lon)
    }

    /// Transit uses 800 m radius.
    pub fn transit_bbox_deg(&self) -> (f64, f64, f64, f64) {
        let r_m   = 800.0_f64;
        let lat   = self.center_lat;
        let d_lat = r_m / 111_320.0;
        let d_lon = r_m / (111_320.0 * lat.to_radians().cos().abs().max(0.001));
        (lat - d_lat, lat + d_lat, self.center_lon - d_lon, self.center_lon + d_lon)
    }
}

impl RTreeObject for CityRect {
    type Envelope = AABB<[f64; 2]>;
    fn envelope(&self) -> AABB<[f64; 2]> {
        AABB::from_corners([self.min_lon, self.min_lat], [self.max_lon, self.max_lat])
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// PBF download (with streaming — no full-file RAM load)
// ─────────────────────────────────────────────────────────────────────────────

/// Download `url` to `dest`, streaming bytes directly to disk.
///
/// Uses an atomic write pattern: data flows into `dest.pbf.partial`
/// and is renamed to `dest` only on successful completion.  This
/// means a previous complete download (e.g. crash between download
/// and scan) is reused automatically without re-fetching.
///
/// Returns `(bytes_written, last_modified_unix_secs)`.
pub async fn download_pbf(
    client: &reqwest::Client,
    url: &str,
    dest: &Path,
) -> Result<(u64, Option<u64>)> {
    use tokio::io::AsyncWriteExt;

    // ── Re-use existing complete download (crash-between-download-and-scan) ─
    // Guard: verify local size == remote Content-Length via HEAD request.
    // This catches leftover partial files that were renamed accidentally
    // or truncated downloads from a previous code version.
    if dest.exists() {
        let existing_bytes = tokio::fs::metadata(dest).await
            .map(|m| m.len()).unwrap_or(0);
        if existing_bytes > 0 {
            // Quick HEAD to get expected size (no body transferred).
            let remote_len: Option<u64> = client
                .head(url)
                .timeout(std::time::Duration::from_secs(30))
                .send()
                .await
                .ok()
                .and_then(|r| r.content_length());

            match remote_len {
                Some(expected) if existing_bytes == expected => {
                    info!("♻️  Reusing existing PBF ({:.1} MB, size verified): {:?}",
                          existing_bytes as f64 / 1_048_576.0,
                          dest.file_name().unwrap_or_default());
                    return Ok((existing_bytes, None));
                }
                Some(expected) => {
                    warn!("⚠️  Existing PBF size mismatch \
                           (local {:.1} MB ≠ remote {:.1} MB) — re-downloading",
                          existing_bytes as f64 / 1_048_576.0,
                          expected as f64 / 1_048_576.0);
                    let _ = tokio::fs::remove_file(dest).await;
                }
                None => {
                    // HEAD failed (offline? redirect?).  Trust the local file
                    // only if it is plausibly large (> 1 MB).
                    if existing_bytes > 1_048_576 {
                        info!("♻️  HEAD unavailable — reusing existing PBF ({:.1} MB): {:?}",
                              existing_bytes as f64 / 1_048_576.0,
                              dest.file_name().unwrap_or_default());
                        return Ok((existing_bytes, None));
                    }
                    warn!("⚠️  Existing PBF too small ({} B) and HEAD unavailable — re-downloading",
                          existing_bytes);
                    let _ = tokio::fs::remove_file(dest).await;
                }
            }
        }
    }

    // ── Validate URL via HEAD before any heavy transfer ─────────────────────
    let head_response = client
        .head(url)
        .timeout(std::time::Duration::from_secs(30))
        .send()
        .await
        .with_context(|| format!("HEAD {} failed", url))?;

    if !head_response.status().is_success() {
        anyhow::bail!("HEAD HTTP {} for {}", head_response.status(), url);
    }

    if let Some(ct) = head_response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
    {
        let ct_l = ct.to_ascii_lowercase();
        if ct_l.contains("text/html") {
            anyhow::bail!(
                "HEAD Content-Type is HTML ({}), not PBF. URL: {}",
                ct,
                url
            );
        }
    }

    let expected_total = head_response.content_length().unwrap_or(0);
    let accepts_ranges = head_response
        .headers()
        .get(reqwest::header::ACCEPT_RANGES)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_ascii_lowercase().contains("bytes"))
        .unwrap_or(false);
    let head_last_modified: Option<u64> = head_response
        .headers()
        .get(reqwest::header::LAST_MODIFIED)
        .and_then(|v| v.to_str().ok())
        .and_then(|s| httpdate::parse_http_date(s).ok())
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs());

    // ── Atomic write: download to .partial, rename on success ────────────────
    let partial = dest.with_extension("pbf.partial");
    // Clean up any leftover partial file from a previous interrupted run.
    if partial.exists() {
        let _ = tokio::fs::remove_file(&partial).await;
    }

    info!("⬇️  Downloading PBF: {}", url);

    let mut written: u64 = 0;
    let mut total = expected_total;
    let mut used_aria2 = false;

    if accepts_ranges && try_download_with_aria2(url, &partial, expected_total).await? {
        used_aria2 = true;
        written = tokio::fs::metadata(&partial)
            .await
            .map(|m| m.len())
            .unwrap_or(0);
    } else if !accepts_ranges {
        info!("ℹ️  Server does not advertise byte-range support; using built-in downloader");
    } else {
        let response = client
            .get(url)
            .timeout(std::time::Duration::from_secs(3600)) // 1 h — large files
            .send()
            .await
            .with_context(|| format!("GET {} failed", url))?;

        if !response.status().is_success() {
            anyhow::bail!("HTTP {} for {}", response.status(), url);
        }

        total = response.content_length().unwrap_or(total);
        let mut file = tokio::fs::File::create(&partial)
            .await
            .with_context(|| format!("Cannot create {:?}", partial))?;

        let mut last_log_mb: u64 = 0;
        let mut stream = response.bytes_stream();

        use futures::StreamExt;
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.context("Download stream error")?;
            file.write_all(&chunk).await.context("Write error")?;
            written += chunk.len() as u64;
            let mb = written / (1024 * 1024);
            if mb >= last_log_mb + 100 {
                last_log_mb = mb;
                if total > 0 {
                    info!("  {}/{} MB ({:.0}%)", mb, total / (1024 * 1024),
                          written as f64 / total as f64 * 100.0);
                } else {
                    info!("  {} MB downloaded…", mb);
                }
            }
        }
        file.flush().await.context("Flush error")?;
        drop(file); // close before rename on Windows
    }

    // ── Validate: reject truncated / empty / HTML-error downloads ───────────
    // Any real OSM PBF is at minimum several KB (even a tiny country).
    // If Content-Length was provided and differs, the download was incomplete.
    const MIN_VALID_BYTES: u64 = 512 * 1024; // 512 KB
    if written < MIN_VALID_BYTES {
        let _ = tokio::fs::remove_file(&partial).await;
        anyhow::bail!(
            "Download too small ({} B) — likely an HTML error page or empty response. \
             URL: {}",
            written, url
        );
    }
    if total > 0 && written < total {
        let _ = tokio::fs::remove_file(&partial).await;
        anyhow::bail!(
            "Incomplete download: got {} MB of {} MB ({:.1}%). URL: {}",
            written / 1_048_576,
            total  / 1_048_576,
            written as f64 / total as f64 * 100.0,
            url
        );
    }

    // Atomic rename: partial → final path
    tokio::fs::rename(&partial, dest)
        .await
        .with_context(|| format!("Rename {:?} → {:?} failed", partial, dest))?;

    if used_aria2 && total > 0 {
        info!(
            "✅ Downloaded {:.0}/{:.0} MB (aria2c) → {:?}",
            written as f64 / 1_048_576.0,
            total as f64 / 1_048_576.0,
            dest
        );
    } else {
        info!("✅ Downloaded {:.0} MB → {:?}", written as f64 / 1_048_576.0, dest);
    }
    Ok((written, head_last_modified))
}

/// Download PBF file with exponential backoff retry logic.
pub async fn download_pbf_with_retry(
    client: &reqwest::Client,
    url: &str,
    dest: &Path,
    label: &str,
) -> Result<(u64, Option<u64>)> {
    const MAX_RETRIES: u32 = 3;
    let mut last_error = String::new();

    // Some Geofabrik extracts occasionally move path (e.g. Russia), or a
    // stale mapping can point to an HTML page. Try known fallback URLs before
    // giving up the entire region batch.
    let mut candidates: Vec<String> = vec![url.to_string()];
    if url == "https://download.geofabrik.de/europe/russia-latest.osm.pbf" {
        candidates.push("https://download.geofabrik.de/russia-latest.osm.pbf".to_string());
    }

    for candidate_url in candidates {
        for attempt in 0..MAX_RETRIES {
            match download_pbf(client, &candidate_url, dest).await {
                Ok(res) => return Ok(res),
                Err(e) => {
                    last_error = e.to_string();
                    if attempt + 1 < MAX_RETRIES {
                        let delay_secs = 30 * (attempt as u64 + 1);
                        warn!(
                            "⚡ Download {} (attempt {}/{}) failed: {} — retrying in {}s",
                            label, attempt + 1, MAX_RETRIES, last_error, delay_secs
                        );
                        tokio::time::sleep(std::time::Duration::from_secs(delay_secs)).await;
                    }
                }
            }
        }

        // All retries for this candidate failed: if another candidate exists,
        // continue immediately with it.
        if candidate_url != url {
            warn!(
                "⚠️  Download {} failed for fallback URL {}: {}",
                label, candidate_url, last_error
            );
        } else if label == "Russia" {
            warn!(
                "⚠️  Download {} failed for primary URL {}, trying fallback URL",
                label, candidate_url
            );
        }
    }
    Err(anyhow::anyhow!(
        "Failed for all candidate URLs ({} retries each): {}",
        MAX_RETRIES,
        last_error
    ))
}

// ─────────────────────────────────────────────────────────────────────────────
// POI extraction from PBF
// ─────────────────────────────────────────────────────────────────────────────

/// Haversine distance in km between two geographic points.
fn haversine_km(lat1: f64, lon1: f64, lat2: f64, lon2: f64) -> f64 {
    const R: f64 = 6371.0;
    let dlat = (lat2 - lat1).to_radians();
    let dlon = (lon2 - lon1).to_radians();
    let a = (dlat / 2.0).sin().powi(2)
        + lat1.to_radians().cos() * lat2.to_radians().cos() * (dlon / 2.0).sin().powi(2);
    2.0 * R * a.sqrt().asin()
}

/// Partial per-element accumulator — used inside `par_map_reduce`.
/// Each instance is local to one parallel worker chunk.
#[derive(Default)]
struct PartialResult {
    /// POI / transit counts for each city.
    counts: HashMap<i64, PoiCounts>,
    /// Candidate water points near each city (lat, lon, dist_km).
    water:  HashMap<i64, f64>, // geoname_id → nearest water km so far
}

impl PartialResult {
    fn merge(mut self, other: Self) -> Self {
        for (id, other_counts) in other.counts {
            let entry = self.counts.entry(id).or_insert_with(|| PoiCounts {
                radius_km: other_counts.radius_km,
                ..Default::default()
            });
            *entry += &other_counts;
        }
        for (id, dist) in other.water {
            let entry = self.water.entry(id).or_insert(f64::MAX);
            if dist < *entry { *entry = dist; }
        }
        self
    }
}

/// Extract POI data for `cities` from a local PBF file.
///
/// Returns a map of `geoname_id → PoiCounts` for every city that had at
/// least one matching element.  Cities with zero POIs are still present in
/// the map (with all-zero counts) so the caller knows they were processed.
pub fn extract_poi_from_pbf(
    pbf_path: &Path,
    cities: &[CityRect],
    processed: &Arc<AtomicUsize>,
) -> Result<HashMap<i64, PoiCounts>> {
    // Build R-tree for fast point-in-bbox lookups.
    // We use separate trees for POI (city radius), transit (800m), water (50km).
    // To avoid three separate trees, we use the *water* bbox (widest) for all
    // lookups and filter by the narrower radii inside the callback.
    let water_rects: Vec<CityRect> = cities.iter().map(|c| {
        // Create a temporary rect with the water bbox dimensions stored in [min/max]
        let (wmin_lat, wmax_lat, wmin_lon, wmax_lon) = c.water_bbox_deg();
        CityRect {
            min_lat: wmin_lat,
            max_lat: wmax_lat,
            min_lon: wmin_lon,
            max_lon: wmax_lon,
            ..*c
        }
    }).collect();
    let tree: RTree<CityRect> = RTree::bulk_load(water_rects);

    // Build a geoname_id → CityRect lookup for accurate per-city radius checks.
    let city_lookup: HashMap<i64, &CityRect> = cities.iter()
        .map(|c| (c.geoname_id, c))
        .collect();

    let reader = ElementReader::from_path(pbf_path)
        .with_context(|| format!("Cannot open PBF {:?}", pbf_path))?;

    let result = reader.par_map_reduce(
        |element| {
            let mut partial = PartialResult::default();

            let (lat, lon, tags_map) = match &element {
                Element::Node(n) => {
                    let tags: HashMap<String, String> = n.tags()
                        .map(|(k, v)| (k.to_string(), v.to_string()))
                        .collect();
                    if tags.is_empty() { return partial; }
                    (n.lat(), n.lon(), tags)
                }
                Element::DenseNode(n) => {
                    let tags: HashMap<String, String> = n.tags()
                        .map(|(k, v)| (k.to_string(), v.to_string()))
                        .collect();
                    if tags.is_empty() { return partial; }
                    (n.lat(), n.lon(), tags)
                }
                // Ways: use the centroid of the first node approximation.
                // osmpbf ways don't carry node coordinates in the default read;
                // for our use-case (leisure parks, malls) nodes dominate.
                _ => return partial,
            };

            // Fast AABB query — finds cities whose *water* bbox contains this point.
            // We then filter by the appropriate radius per element type.
            let point_envelope = AABB::from_corners([lon, lat], [lon, lat]);
            let candidates = tree.locate_in_envelope_intersecting(&point_envelope);

            for city_rect in candidates {
                let city = match city_lookup.get(&city_rect.geoname_id) {
                    Some(c) => c,
                    None => continue,
                };

                // Determine whether this element falls within each radius type.
                let in_poi_bbox = lat >= city.min_lat && lat <= city.max_lat
                    && lon >= city.min_lon && lon <= city.max_lon;

                let (t_min_lat, t_max_lat, t_min_lon, t_max_lon) = city.transit_bbox_deg();
                let in_transit_bbox = lat >= t_min_lat && lat <= t_max_lat
                    && lon >= t_min_lon && lon <= t_max_lon;

                // Water: no further filter needed — the tree already uses water bbox.
                let is_water_tag = tags_map.get("natural").map(|s| {
                    matches!(s.as_str(), "water" | "coastline" | "bay")
                }).unwrap_or(false)
                || tags_map.get("waterway").map(|s| {
                    matches!(s.as_str(), "river" | "canal")
                }).unwrap_or(false);

                if is_water_tag {
                    let dist = haversine_km(city.center_lat, city.center_lon, lat, lon);
                    let entry = partial.water.entry(city.geoname_id).or_insert(f64::MAX);
                    if dist < *entry { *entry = dist; }
                    continue; // water elements are not POIs
                }

                if !in_poi_bbox && !in_transit_bbox { continue; }

                let entry = partial.counts.entry(city.geoname_id).or_insert_with(|| PoiCounts {
                    radius_km: city.radius_km,
                    ..Default::default()
                });

                // Temporarily restrict to appropriate radius type.
                // Transit tags are only counted within 800m.
                let effective_tags = if !in_poi_bbox && in_transit_bbox {
                    // Only transit-relevant tags are meaningful here.
                    // Zero out non-transit keys to avoid over-counting.
                    let mut t = HashMap::new();
                    for k in &["railway", "highway", "public_transport"] {
                        if let Some(v) = tags_map.get(*k) {
                            t.insert(k.to_string(), v.clone());
                        }
                    }
                    t
                } else {
                    tags_map.clone()
                };

                let (is_poi, _is_transit, _is_water) =
                    parse_element_tags(&effective_tags, entry);
                if is_poi { entry.total_poi += 1; }
            }

            partial
        },
        PartialResult::default,
        |a, b| a.merge(b),
    )?;

    // Merge water distances back into counts.
    let mut final_map: HashMap<i64, PoiCounts> = result.counts;

    // Ensure every city has an entry (even with zero POIs).
    for c in cities {
        final_map.entry(c.geoname_id).or_insert_with(|| PoiCounts {
            radius_km: c.radius_km,
            ..Default::default()
        });
        processed.fetch_add(1, Ordering::Relaxed);
    }
    for (id, dist) in result.water {
        if let Some(counts) = final_map.get_mut(&id) {
            let current = counts.nearest_water_km.unwrap_or(f64::MAX);
            if dist < current {
                counts.nearest_water_km = Some(dist);
            }
        }
    }

    Ok(final_map)
}

// ─────────────────────────────────────────────────────────────────────────────
// City grouping helpers
// ─────────────────────────────────────────────────────────────────────────────

/// A batch of cities that share the same Geofabrik download URL.
pub struct RegionBatch {
    pub label:  &'static str,
    pub url:    &'static str,
    pub cities: Vec<CityRect>,
    /// geoname_id → (lat, lon, population) — kept for climate fetch
    pub meta:   Vec<(i64, f64, f64, i64, String, String)>,
    // (geoname_id, lat, lon, pop, city_name, country_code)
}

/// Group `cities` (from DB) into per-Geofabrik-file batches.
/// Cities in the same batch share a single PBF download → process → delete cycle.
pub fn group_by_region<C>(cities: C) -> Vec<RegionBatch>
where
    C: IntoIterator<Item = crate::city::CityBasic>,
{
    let mut map: HashMap<String, RegionBatch> = HashMap::new();

    for city in cities {
        let (label, url) = if city.country_code == "US" {
            us_subregion_url(city.latitude, city.longitude)
        } else {
            geofabrik_region(&city.country_code)
        };

        // Resolve city URL to actual URL (US placeholder was returned inline already)
        let actual_url = if url == "us_subregion_placeholder" {
            // Should not reach here — us_subregion_url is called above
            "https://download.geofabrik.de/north-america/us-latest.osm.pbf"
        } else {
            url
        };

        // Skip cities whose country code has no Geofabrik mapping rather than
        // falling back to the ~80 GB planet file.
        if actual_url == "pbf://unmapped" {
            warn!(
                "No Geofabrik PBF mapping for country '{}' (geoname_id={}, city='{}') — skipping",
                city.country_code, city.geoname_id, city.name
            );
            continue;
        }

        let batch = map.entry(actual_url.to_string()).or_insert_with(|| RegionBatch {
            label,
            url: actual_url,
            cities: Vec::new(),
            meta: Vec::new(),
        });

        batch.cities.push(CityRect::new(
            city.geoname_id,
            city.latitude,
            city.longitude,
            city.population,
        ));
        batch.meta.push((
            city.geoname_id,
            city.latitude,
            city.longitude,
            city.population,
            city.name,
            city.country_code,
        ));
    }

    // Sort: largest batch first so slowest downloads happen early.
    let mut batches: Vec<RegionBatch> = map.into_values().collect();
    batches.sort_unstable_by(|a, b| b.cities.len().cmp(&a.cities.len()));
    batches
}

/// Remove the PBF temp file, logging any error rather than crashing.
pub fn delete_pbf(path: &Path) {
    match std::fs::remove_file(path) {
        Ok(_)  => info!("🗑️  Deleted PBF: {:?}", path.file_name().unwrap_or_default()),
        Err(e) => warn!("Could not delete {:?}: {}", path, e),
    }
}

/// Construct a unique temp-file path for a PBF download.
pub fn pbf_tmp_path(base_dir: &Path, label: &str) -> PathBuf {
    base_dir.join(format!("eodi_{}.pbf", label.to_lowercase().replace(' ', "_")))
}

/// Construct the checkpoint file path for a given batch label.
/// Checkpoint stores the extracted POI map (~few MB) so the 7GB+ PBF
/// does not need to be re-downloaded if the process is interrupted.
pub fn poi_checkpoint_path(base_dir: &Path, label: &str) -> PathBuf {
    base_dir.join(format!("eodi_{}.poi_ckpt", label.to_lowercase().replace(' ', "_")))
}

/// Serialize `poi_map` to a small binary checkpoint file.
/// On a 32,987-city dataset this is roughly 3–8 MB.
pub fn save_poi_checkpoint(
    path: &Path,
    poi_map: &HashMap<i64, crate::poi::PoiCounts>,
) -> Result<()> {
    let bytes = bincode::serialize(poi_map).context("serialize poi checkpoint")?;
    std::fs::write(path, &bytes)
        .with_context(|| format!("write checkpoint {:?}", path))?;
    info!("💾 Checkpoint saved ({:.1} MB): {:?}",
        bytes.len() as f64 / 1_048_576.0,
        path.file_name().unwrap_or_default());
    Ok(())
}

/// Load a previously saved POI checkpoint.
/// Returns `None` if the file does not exist (use normal download path).
pub fn load_poi_checkpoint(
    path: &Path,
) -> Result<Option<HashMap<i64, crate::poi::PoiCounts>>> {
    if !path.exists() {
        return Ok(None);
    }
    let bytes = std::fs::read(path)
        .with_context(|| format!("read checkpoint {:?}", path))?;
    let map: HashMap<i64, crate::poi::PoiCounts> =
        bincode::deserialize(&bytes).context("deserialize poi checkpoint")?;
    info!("📂 Loaded checkpoint ({} cities): {:?}",
        map.len(), path.file_name().unwrap_or_default());
    Ok(Some(map))
}

/// Path for the timestamp sidecar file of a checkpoint.
/// Stores the `Last-Modified` Unix timestamp of the Geofabrik PBF used
/// to create the checkpoint, so future runs can detect upstream updates.
pub fn ckpt_ts_path(ckpt_path: &Path) -> PathBuf {
    let mut p = ckpt_path.to_path_buf();
    let name = p
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .into_owned();
    p.set_file_name(format!("{}.ts", name));
    p
}

/// Save a Unix timestamp (seconds) to the timestamp sidecar file.
pub fn save_ckpt_timestamp(path: &Path, ts: u64) {
    match std::fs::write(path, ts.to_le_bytes()) {
        Ok(_)  => info!("💾 Saved PBF timestamp ({}) → {:?}", ts, path.file_name().unwrap_or_default()),
        Err(e) => warn!("Could not save timestamp sidecar {:?}: {}", path, e),
    }
}

/// Load a Unix timestamp from the sidecar file.
/// Returns `None` if the file is missing or malformed.
pub fn load_ckpt_timestamp(path: &Path) -> Option<u64> {
    let bytes = std::fs::read(path).ok()?;
    let arr: [u8; 8] = bytes.get(..8)?.try_into().ok()?;
    Some(u64::from_le_bytes(arr))
}

/// Issue an HTTP HEAD request and return the `Last-Modified` header
/// as Unix seconds.  Returns `None` on network error or missing header.
pub async fn remote_last_modified(client: &reqwest::Client, url: &str) -> Option<u64> {
    let resp = client
        .head(url)
        .timeout(std::time::Duration::from_secs(30))
        .send()
        .await
        .ok()?;
    let lm = resp.headers().get(reqwest::header::LAST_MODIFIED)?;
    let s = lm.to_str().ok()?;
    httpdate::parse_http_date(s)
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
}

/// Delete a checkpoint file and its timestamp sidecar (call after DB save).
pub fn delete_poi_checkpoint(path: &Path) {
    match std::fs::remove_file(path) {
        Ok(_)  => info!("🗑️  Deleted checkpoint: {:?}", path.file_name().unwrap_or_default()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => warn!("Could not delete checkpoint {:?}: {}", path, e),
    }
    // Also remove the timestamp sidecar, if present.
    let ts_path = ckpt_ts_path(path);
    if ts_path.exists() {
        let _ = std::fs::remove_file(&ts_path);
    }
}


// ─────────────────────────────────────────────────────────────────────────────
// Hex-level POI checkpoints (HashMap<u64, PoiCounts> keyed by H3 cell index)
// ─────────────────────────────────────────────────────────────────────────────

/// Path for a hex-level POI checkpoint for the given Geofabrik region label.
/// File extension `.hex_poi_ckpt` distinguishes from city-level `.poi_ckpt`.
pub fn hex_poi_checkpoint_path(base_dir: &Path, label: &str) -> PathBuf {
    base_dir.join(format!(
        "eodi_{}.hex_poi_ckpt",
        label.to_lowercase().replace(' ', "_")
    ))
}

/// Serialize a hex→POI map to a binary checkpoint file.
pub fn save_hex_poi_checkpoint(
    path: &Path,
    poi_map: &HashMap<u64, crate::poi::PoiCounts>,
) -> Result<()> {
    let bytes = bincode::serialize(poi_map).context("serialize hex poi checkpoint")?;
    std::fs::write(path, &bytes)
        .with_context(|| format!("write hex checkpoint {:?}", path))?;
    info!(
        "💾 Hex checkpoint saved ({:.1} MB): {:?}",
        bytes.len() as f64 / 1_048_576.0,
        path.file_name().unwrap_or_default()
    );
    Ok(())
}

/// Load a hex POI checkpoint. Returns `None` if the file does not exist.
pub fn load_hex_poi_checkpoint(
    path: &Path,
) -> Result<Option<HashMap<u64, crate::poi::PoiCounts>>> {
    if !path.exists() {
        return Ok(None);
    }
    let bytes =
        std::fs::read(path).with_context(|| format!("read hex checkpoint {:?}", path))?;
    let map: HashMap<u64, crate::poi::PoiCounts> =
        bincode::deserialize(&bytes).context("deserialize hex poi checkpoint")?;
    info!(
        "📂 Loaded hex checkpoint ({} cells): {:?}",
        map.len(),
        path.file_name().unwrap_or_default()
    );
    Ok(Some(map))
}

/// Load **all** hex POI checkpoint files from `base_dir`, merging them into a
/// single `HashMap<u64, PoiCounts>`.
///
/// Files must end with `.hex_poi_ckpt`.  Returns an empty map (not an error)
/// when no checkpoint files are present — the pipeline proceeds without POI
/// data and hexagons get `total_poi = 0` / `is_valid = false`.
pub fn load_all_hex_poi_checkpoints_with_fallback(
    base_dir: &Path,
) -> Result<HashMap<u64, crate::poi::PoiCounts>> {
    let mut merged: HashMap<u64, crate::poi::PoiCounts> = HashMap::new();

    let entries = match std::fs::read_dir(base_dir) {
        Ok(e) => e,
        Err(e) => {
            warn!(
                "⚠️  Cannot scan {:?} for hex checkpoints: {}",
                base_dir, e
            );
            return Ok(merged);
        }
    };

    let mut found = 0usize;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) == Some("hex_poi_ckpt") {
            match load_hex_poi_checkpoint(&path) {
                Ok(Some(map)) => {
                    merged.extend(map);
                    found += 1;
                }
                Ok(None) => {}
                Err(e) => warn!("⚠️  Failed to load hex checkpoint {:?}: {}", path, e),
            }
        }
    }

    if found > 0 {
        info!(
            "📂 Merged {} hex POI checkpoint(s) → {} cells total",
            found,
            merged.len()
        );
    }

    Ok(merged)
}
