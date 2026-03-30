//! License management for eodi.me
//!
//! # Architecture
//! - License state stored in `%APPDATA%/eodi.me/license.json`
//! - Validated locally on every app start (expiry + grace period check)
//! - Online re-validation via LemonSqueezy API (once per week when online)
//! - Engine receives `--plan=<tier>` CLI arg → enforces tier-gated endpoints
//!
//! # Tiers
//!   free → personal ($8/mo) → solo_biz ($19/mo) → business ($99/mo) → enterprise ($249/mo)
//!
//! # LemonSqueezy integration
//! - `LEMON_VARIANT_PERSONAL`, `LEMON_VARIANT_SOLO_BIZ`, etc. set at compile time via
//!   environment variables (see README § Build).  Fall back to variant_name matching.

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use std::path::{Path, PathBuf};
use tracing::{info, warn};

type HmacSha256 = Hmac<Sha256>;

// HMAC key is reconstructed at runtime from two partial arrays.
// Neither array alone constitutes the secret; they must be XOR-combined.
// Symbol names are stripped in release builds (strip = true in Cargo.toml).
const _KM: &[u8] = &[
    0x64, 0x1f, 0x3f, 0x0f, 0x24, 0x4c, 0x8b, 0xbc,
    0x85, 0x2e, 0x5e, 0xc1, 0x8e, 0xad, 0x1d, 0x1c,
    0x14, 0x21, 0x85, 0xb8, 0x47, 0xde, 0x80, 0x80,
    0x4b, 0xfb, 0xc5, 0x7d, 0xd6, 0x72, 0xb5, 0xf2,
];
const _KD: &[u8] = &[
    0x0f, 0x21, 0x9a, 0x18, 0xfd, 0x00, 0x09, 0x4c,
    0xae, 0x73, 0xb6, 0xb0, 0xb4, 0x3b, 0xd9, 0x13,
    0x6a, 0x72, 0x3d, 0x91, 0x96, 0xba, 0x1a, 0xc7,
    0x47, 0x0e, 0xf4, 0xf3, 0x70, 0x2b, 0x98, 0x4e,
];

#[inline(never)]
fn license_integrity_key() -> [u8; 32] {
    let mut k = [0u8; 32];
    for i in 0..32 {
        k[i] = _KD[i] ^ _KM[i];
    }
    k
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/// Grace period after subscription expiry before features are hard-blocked.
const GRACE_PERIOD_SECS: u64 = 14 * 24 * 3600; // 14 days

/// Re-verify with LemonSqueezy after this many seconds (7 days).
const REVERIFY_INTERVAL_SECS: u64 = 7 * 24 * 3600;

const LEMON_ACTIVATE_URL:   &str = "https://api.lemonsqueezy.com/v1/licenses/activate";
const LEMON_VALIDATE_URL:   &str = "https://api.lemonsqueezy.com/v1/licenses/validate";
const LEMON_DEACTIVATE_URL: &str = "https://api.lemonsqueezy.com/v1/licenses/deactivate";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/// Subscription plan tier — matches TypeScript `Plan` union type exactly.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Plan {
    Free,
    Personal,
    SoloBiz,
    Business,
    Enterprise,
}

impl Default for Plan {
    fn default() -> Self {
        Plan::Free
    }
}

impl Plan {
    /// Returns the string passed to the engine as `--plan=<str>`.
    pub fn as_str(&self) -> &'static str {
        match self {
            Plan::Free       => "free",
            Plan::Personal   => "personal",
            Plan::SoloBiz    => "solo_biz",
            Plan::Business   => "business",
            Plan::Enterprise => "enterprise",
        }
    }

    /// True for any paid, active plan.
    pub fn is_paid(&self) -> bool {
        !matches!(self, Plan::Free)
    }

    /// Infer the plan tier from a LemonSqueezy variant name (case-insensitive, fuzzy).
    pub fn from_variant_name(name: &str) -> Self {
        let n = name.to_ascii_lowercase();
        if n.contains("enterprise") {
            Plan::Enterprise
        } else if n.contains("business") || n.contains("biz") && !n.contains("solo") {
            Plan::Business
        } else if n.contains("solo") {
            Plan::SoloBiz
        } else if n.contains("personal") {
            Plan::Personal
        } else {
            // Unknown paid variant — grant Personal as minimum
            warn!("Unknown variant name '{}', defaulting to Personal", name);
            Plan::Personal
        }
    }
}

/// Persisted license data — written to `%APPDATA%/eodi.me/license.json`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LicenseFile {
    /// Raw license key entered by the user.
    pub license_key: String,
    /// Instance ID returned by LemonSqueezy on activation (needed for deactivate/validate).
    pub instance_id: String,
    pub plan: Plan,
    /// UNIX timestamp when first activated on this machine.
    pub activated_at_unix: u64,
    /// UNIX timestamp when the current billing period ends. `None` = lifetime / one-time.
    pub expires_at_unix: Option<u64>,
    /// UNIX timestamp of the last successful online re-validation.
    pub last_verified_at_unix: u64,
    /// HMAC-SHA256 integrity signature over key fields — prevents JSON tampering.
    #[serde(default)]
    pub integrity_sig: Option<String>,
}

/// Public-facing license status — serialized to the React frontend via Tauri IPC.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LicenseStatus {
    pub plan: Plan,
    /// True if within the validity window (including grace period).
    pub is_active: bool,
    /// Obfuscated key for display, e.g. "EODI-****-****-****".
    pub license_key_hint: Option<String>,
    /// Human-readable expiry, e.g. "2027-03-01" or "Lifetime".
    pub expires_label: String,
    /// True when 7+ days since last online check — frontend should call `verify_license_online`.
    pub needs_verification: bool,
    /// Days until expiry (positive = days remaining, negative = days into grace period).
    /// None for lifetime licenses or Free tier.
    pub days_until_expiry: Option<i64>,
    /// True when license has expired but is still within the 14-day grace window.
    pub in_grace_period: bool,
}

impl LicenseStatus {
    pub fn free_tier() -> Self {
        Self {
            plan: Plan::Free,
            is_active: false,
            license_key_hint: None,
            expires_label: "—".to_string(),
            needs_verification: false,
            days_until_expiry: None,
            in_grace_period: false,
        }
    }

    /// True when any paid plan is active (backward-compat helper, may be used by external callers).
    #[allow(dead_code)]
    pub fn is_pro(&self) -> bool {
        self.plan.is_paid() && self.is_active
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Path helpers
// ─────────────────────────────────────────────────────────────────────────────

/// Returns the directory used for eodi.me app data.
/// Windows: `%APPDATA%/eodi.me`  macOS: `~/Library/Application Support/eodi.me`
pub fn app_data_dir() -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        std::env::var("APPDATA")
            .map(|p| PathBuf::from(p).join("eodi.me"))
            .unwrap_or_else(|_| PathBuf::from(".eodi"))
    }
    #[cfg(not(target_os = "windows"))]
    {
        dirs_next::data_local_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("eodi.me")
    }
}

fn license_file_path(dir: &Path) -> PathBuf {
    dir.join("license.json")
}

fn ensure_dir(dir: &Path) -> std::io::Result<()> {
    if !dir.exists() {
        std::fs::create_dir_all(dir)?;
    }
    Ok(())
}

fn stamp_path(dir: &Path) -> PathBuf {
    dir.join(".act")
}

/// Write an HMAC-signed activation record to disk.
/// Called after successful LemonSqueezy activation.
/// Presence of this file + absence of license.json indicates suspicious deletion.
fn write_activation_stamp(instance_id: &str, activated_at: u64) {
    let dir = app_data_dir();
    let path = stamp_path(&dir);
    let payload = format!("{}:{}", instance_id, activated_at);
    let key = license_integrity_key();
    let mut mac = match HmacSha256::new_from_slice(&key) {
        Ok(m) => m,
        Err(_) => return, // Silently fail — non-critical stamp operation
    };
    mac.update(payload.as_bytes());
    let sig = B64.encode(mac.finalize().into_bytes());
    let content = format!("{}:{}", payload, sig);
    let _ = std::fs::write(&path, content);
}

/// Returns true if the activation stamp file exists (regardless of validity).
fn activation_stamp_exists() -> bool {
    stamp_path(&app_data_dir()).exists()
}

/// Remove the activation stamp — called on intentional deactivation.
fn remove_activation_stamp() {
    let path = stamp_path(&app_data_dir());
    let _ = std::fs::remove_file(path);
}

// ─────────────────────────────────────────────────────────────────────────────
// Core: local file I/O
// ─────────────────────────────────────────────────────────────────────────────

/// Read and validate the local license file — no network required.
/// Returns `Free` tier when file is absent, corrupt, or expired beyond grace period.
pub fn read_license() -> LicenseStatus {
    let dir = app_data_dir();
    let path = license_file_path(&dir);

    let raw = match std::fs::read_to_string(&path) {
        Ok(s) => s,
        Err(_) => {
            // If an activation stamp exists but the license file is gone,
            // this looks like deliberate deletion to reset to grace period.
            // Return Free immediately with needs_verification=true (no grace).
            if activation_stamp_exists() {
                warn!("license.json missing but activation stamp exists — possible tamper, forcing verification");
                return LicenseStatus {
                    needs_verification: true,
                    ..LicenseStatus::free_tier()
                };
            }
            return LicenseStatus::free_tier();
        }
    };

    let lf: LicenseFile = match serde_json::from_str(&raw) {
        Ok(v) => v,
        Err(e) => {
            warn!("License file corrupt: {}", e);
            return LicenseStatus::free_tier();
        }
    };

    // Verify HMAC integrity — reject tampered files.
    // Files without a sig (old format) are treated as needing re-verification.
    let sig_valid = match &lf.integrity_sig {
        Some(_) => verify_license_sig(&lf),
        None => false, // no sig → needs online verification
    };

    let now = unix_now();

    // is_active: true if no expiry, or within grace period.
    // After grace period expires, force Free tier — not just a warning.
    let grace_expired = lf
        .expires_at_unix
        .map_or(false, |exp| now >= exp + GRACE_PERIOD_SECS);
    let is_active = lf
        .expires_at_unix
        .map_or(true, |exp| now < exp + GRACE_PERIOD_SECS);

    // Tampered file → hard block to Free.
    if !sig_valid {
        if lf.integrity_sig.is_some() {
            warn!("License file integrity check FAILED — possible tampering, reverting to Free");
            return LicenseStatus::free_tier();
        }
        // Old file without sig: keep plan but require immediate re-verification
        warn!("License file has no integrity signature — flagging for re-verification");
    }

    // Grace period fully expired → hard downgrade to Free.
    if grace_expired {
        warn!(
            "License grace period expired for plan={} — downgrading to Free. Re-activate to restore.",
            lf.plan.as_str()
        );
        return LicenseStatus::free_tier();
    }

    let needs_verification = !sig_valid
        || now.saturating_sub(lf.last_verified_at_unix) > REVERIFY_INTERVAL_SECS;
    let expires_label = lf
        .expires_at_unix
        .map(format_unix_date)
        .unwrap_or_else(|| "Lifetime".to_string());
    let key_hint = Some(obfuscate_key(&lf.license_key));

    // Compute grace period info for frontend warnings
    let (days_until_expiry, in_grace_period) = match lf.expires_at_unix {
        None => (None, false), // Lifetime license
        Some(exp) => {
            let secs_remaining = exp as i64 - now as i64;
            let days = secs_remaining / 86400;
            let in_grace = secs_remaining < 0 && now < exp + GRACE_PERIOD_SECS;
            (Some(days), in_grace)
        }
    };

    info!(
        "License: plan={} active={} sig_valid={} needs_verify={} days_until_expiry={:?} in_grace={}",
        lf.plan.as_str(),
        is_active,
        sig_valid,
        needs_verification,
        days_until_expiry,
        in_grace_period,
    );

    LicenseStatus {
        plan: lf.plan,
        is_active,
        license_key_hint: key_hint,
        expires_label,
        needs_verification,
        days_until_expiry,
        in_grace_period,
    }
}

fn write_license_file(lf: &LicenseFile) -> Result<(), String> {
    let dir = app_data_dir();
    ensure_dir(&dir).map_err(|e| e.to_string())?;
    let path = license_file_path(&dir);
    // Compute integrity signature before writing
    let mut lf_with_sig = lf.clone();
    lf_with_sig.integrity_sig = Some(compute_license_sig(lf));
    let json = serde_json::to_string_pretty(&lf_with_sig).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| e.to_string())?;
    Ok(())
}

fn read_license_file() -> Result<LicenseFile, String> {
    let path = license_file_path(&app_data_dir());
    let raw = std::fs::read_to_string(&path)
        .map_err(|_| "No active license found.".to_string())?;
    serde_json::from_str(&raw).map_err(|e| format!("License file corrupt: {}", e))
}

// ─────────────────────────────────────────────────────────────────────────────
// LemonSqueezy API — HTTP types
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct LsActivateResponse {
    activated: bool,
    error: Option<String>,
    #[serde(default)]
    instance: Option<LsInstance>,
    #[serde(default)]
    license_key: Option<LsLicenseKey>,
    #[serde(default)]
    meta: Option<LsMeta>,
}

#[derive(Deserialize)]
struct LsValidateResponse {
    valid: bool,
    error: Option<String>,
    #[serde(default)]
    license_key: Option<LsLicenseKey>,
    #[serde(default)]
    meta: Option<LsMeta>,
}

#[derive(Deserialize)]
struct LsInstance {
    id: String,
}

#[derive(Deserialize)]
struct LsLicenseKey {
    expires_at: Option<String>, // ISO 8601 or null
    #[allow(dead_code)]
    status: Option<String>,
}

#[derive(Deserialize)]
struct LsMeta {
    #[serde(default)]
    variant_name: Option<String>,
}

// ─────────────────────────────────────────────────────────────────────────────
// Core: LemonSqueezy API calls (blocking — call from tokio::task::spawn_blocking)
// ─────────────────────────────────────────────────────────────────────────────

/// Activate a LemonSqueezy license key on this machine.
/// Calls the LS Activate endpoint, stores the result locally, and returns the new status.
pub fn activate_license(key: &str) -> Result<LicenseStatus, String> {
    let hostname = hostname();
    info!("Activating license key for instance '{}'", hostname);

    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| format!("HTTP client error: {}", e))?;

    let resp = client
        .post(LEMON_ACTIVATE_URL)
        .json(&serde_json::json!({
            "license_key": key,
            "instance_name": hostname
        }))
        .send()
        .map_err(|e| format!("Network error: {}. Check your internet connection.", e))?;

    let status_code = resp.status();
    let body: LsActivateResponse = resp
        .json()
        .map_err(|e| format!("Unexpected response from license server: {}", e))?;

    if !body.activated {
        let msg = body
            .error
            .unwrap_or_else(|| format!("Activation failed (HTTP {})", status_code));
        return Err(msg);
    }

    let instance_id = body
        .instance
        .as_ref()
        .map(|i| i.id.clone())
        .unwrap_or_default();

    let variant_name = body
        .meta
        .as_ref()
        .and_then(|m| m.variant_name.as_deref())
        .unwrap_or("personal");

    let plan = Plan::from_variant_name(variant_name);

    let expires_at_unix = body
        .license_key
        .as_ref()
        .and_then(|lk| lk.expires_at.as_deref())
        .and_then(parse_iso_to_unix);

    let now = unix_now();
    let lf = LicenseFile {
        license_key: key.to_string(),
        instance_id,
        plan,
        activated_at_unix: now,
        expires_at_unix,
        last_verified_at_unix: now,
        integrity_sig: None, // computed by write_license_file
    };

    write_license_file(&lf)?;
    write_activation_stamp(&lf.instance_id, lf.activated_at_unix);
    info!("License activated: plan={}", lf.plan.as_str());
    Ok(read_license())
}

/// Deactivate the current license — releases one activation slot on LemonSqueezy.
pub fn deactivate_license() -> Result<(), String> {
    let lf = read_license_file()?;

    // Best-effort remote deactivation — don't fail if network is unavailable
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .ok();

    if let Some(client) = client {
        let _ = client
            .post(LEMON_DEACTIVATE_URL)
            .json(&serde_json::json!({
                "license_key": lf.license_key,
                "instance_id": lf.instance_id
            }))
            .send()
            .ok();
    }

    let path = license_file_path(&app_data_dir());
    if path.exists() {
        std::fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    remove_activation_stamp();
    info!("License deactivated and file removed");
    Ok(())
}

/// Re-validate the license with LemonSqueezy (called once per week when online).
/// Updates the local file with fresh expiry and plan info.
pub fn verify_online() -> Result<LicenseStatus, String> {
    let lf = match read_license_file() {
        Ok(f) => f,
        Err(_) => return Ok(LicenseStatus::free_tier()),
    };

    info!("Verifying license online for plan={}", lf.plan.as_str());

    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| format!("HTTP client error: {}", e))?;

    let resp = client
        .post(LEMON_VALIDATE_URL)
        .json(&serde_json::json!({
            "license_key": lf.license_key,
            "instance_id": lf.instance_id
        }))
        .send()
        .map_err(|e| format!("Network error: {}", e))?;

    let body: LsValidateResponse = resp
        .json()
        .map_err(|e| format!("Unexpected response: {}", e))?;

    if let Some(err) = &body.error {
        warn!("License validation returned error: {}", err);
    }

    // Determine updated plan from variant_name if present
    let plan = if body.valid {
        body.meta
            .as_ref()
            .and_then(|m| m.variant_name.as_deref())
            .map(Plan::from_variant_name)
            .unwrap_or(lf.plan.clone())
    } else {
        warn!("License validation: valid=false, downgrading to Free");
        Plan::Free
    };

    // Refresh expiry from server response (handles renewal and cancellation)
    let expires_at_unix = body
        .license_key
        .as_ref()
        .and_then(|lk| lk.expires_at.as_deref())
        .and_then(parse_iso_to_unix)
        .or(lf.expires_at_unix);

    let updated = LicenseFile {
        plan,
        expires_at_unix,
        last_verified_at_unix: unix_now(),
        ..lf
    };

    write_license_file(&updated)?;
    info!("License verified: plan={}", updated.plan.as_str());
    Ok(read_license())
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

fn unix_now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

/// Format a UNIX timestamp as "YYYY-MM-DD" without external crates.
fn format_unix_date(secs: u64) -> String {
    let days = secs / 86400;
    let jd = days + 2440588; // Julian Day Number for 1970-01-01
    let l = jd + 68569;
    let n = 4 * l / 146097;
    let l = l - (146097 * n + 3) / 4;
    let i = 4000 * (l + 1) / 1461001;
    let l = l - 1461 * i / 4 + 31;
    let j = 80 * l / 2447;
    let d = l - 2447 * j / 80;
    let l = j / 11;
    let m = j + 2 - 12 * l;
    let y = 100 * (n - 49) + i + l;
    format!("{:04}-{:02}-{:02}", y, m, d)
}

/// Obfuscate license key for display — keeps first segment, masks the rest.
/// "EODI-ABCD-EFGH-IJKL" → "EODI-****-****-****"
fn obfuscate_key(key: &str) -> String {
    let parts: Vec<&str> = key.splitn(5, '-').collect();
    if parts.len() <= 1 {
        return "****".to_string();
    }
    let mut result = parts[0].to_string();
    for _ in 1..parts.len() {
        result.push_str("-****");
    }
    result
}

/// Returns the machine hostname for LemonSqueezy instance naming.
fn hostname() -> String {
    std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .unwrap_or_else(|_| "unknown-host".to_string())
}

/// Parse ISO 8601 date-time string to UNIX timestamp.
/// Handles "2027-03-01T00:00:00.000000Z" and bare "2027-03-01".
fn parse_iso_to_unix(s: &str) -> Option<u64> {
    // Take only the date part "YYYY-MM-DD"
    let date = s.get(..10)?;
    let parts: Vec<&str> = date.split('-').collect();
    if parts.len() != 3 {
        return None;
    }
    let y: u64 = parts[0].parse().ok()?;
    let m: u64 = parts[1].parse().ok()?;
    let d: u64 = parts[2].parse().ok()?;

    // Days from 1970-01-01 to YYYY-MM-DD (Gregorian)
    let days = days_since_epoch(y, m, d)?;
    Some(days * 86400)
}

/// Compute days since 1970-01-01 for a given Gregorian date.
fn days_since_epoch(y: u64, m: u64, d: u64) -> Option<u64> {
    // Use the inverse of the Julian Day algorithm
    let jd = julian_day(y, m, d)?;
    let epoch_jd: u64 = 2440588; // Julian Day for 1970-01-01
    jd.checked_sub(epoch_jd)
}

fn julian_day(y: u64, m: u64, d: u64) -> Option<u64> {
    // Valid for Gregorian calendar after 1582
    let a = (14u64.checked_sub(m)?) / 12;
    let yy = y + 4800 - a;
    let mm = m + 12 * a - 3;
    Some(d + (153 * mm + 2) / 5 + 365 * yy + yy / 4 - yy / 100 + yy / 400 - 32045)
}

// ─────────────────────────────────────────────────────────────────────────────
// License integrity (HMAC-SHA256)
// ─────────────────────────────────────────────────────────────────────────────

/// Compute HMAC-SHA256 over the immutable license fields and return as base64.
/// Fields: license_key | instance_id | plan | activated_at_unix | expires_at_unix
fn compute_license_sig(lf: &LicenseFile) -> String {
    let key = license_integrity_key();
    let mut mac = match HmacSha256::new_from_slice(&key) {
        Ok(m) => m,
        Err(_) => return String::new(), // Cannot compute — return empty sig
    };
    mac.update(lf.license_key.as_bytes());
    mac.update(b"|");
    mac.update(lf.instance_id.as_bytes());
    mac.update(b"|");
    mac.update(lf.plan.as_str().as_bytes());
    mac.update(b"|");
    mac.update(lf.activated_at_unix.to_string().as_bytes());
    mac.update(b"|");
    mac.update(
        lf.expires_at_unix
            .map(|v| v.to_string())
            .unwrap_or_default()
            .as_bytes(),
    );
    B64.encode(mac.finalize().into_bytes())
}

/// Verify the stored HMAC signature. Returns false on mismatch or missing sig.
fn verify_license_sig(lf: &LicenseFile) -> bool {
    let expected = compute_license_sig(lf);
    let stored = match &lf.integrity_sig {
        Some(s) => s.as_str(),
        None => return false,
    };
    // Constant-time comparison to prevent timing side-channels
    expected.len() == stored.len()
        && expected
            .bytes()
            .zip(stored.bytes())
            .fold(0u8, |acc, (a, b)| acc | (a ^ b))
            == 0
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn free_tier_default() {
        let s = LicenseStatus::free_tier();
        assert!(!s.is_pro());
        assert_eq!(s.plan, Plan::Free);
    }

    #[test]
    fn format_date_known() {
        // 2026-03-01 00:00:00 UTC = day 20513 since epoch = 20513 * 86400 = 1772323200
        assert_eq!(format_unix_date(1772323200), "2026-03-01");
        // 2026-03-02 = 1772323200 + 86400 = 1772409600
        assert_eq!(format_unix_date(1772409600), "2026-03-02");
    }

    #[test]
    fn obfuscate_key_standard() {
        assert_eq!(obfuscate_key("EODI-ABCD-EFGH-IJKL"), "EODI-****-****-****");
    }

    #[test]
    fn obfuscate_key_short() {
        // No dashes → fully masked
        assert_eq!(obfuscate_key("SHORT"), "****");
    }

    #[test]
    fn plan_as_str() {
        assert_eq!(Plan::Personal.as_str(), "personal");
        assert_eq!(Plan::SoloBiz.as_str(), "solo_biz");
        assert_eq!(Plan::Business.as_str(), "business");
        assert_eq!(Plan::Enterprise.as_str(), "enterprise");
        assert_eq!(Plan::Free.as_str(), "free");
    }

    #[test]
    fn plan_serde_snake_case() {
        let json = serde_json::to_string(&Plan::SoloBiz).unwrap();
        assert_eq!(json, "\"solo_biz\"");
        let back: Plan = serde_json::from_str("\"solo_biz\"").unwrap();
        assert_eq!(back, Plan::SoloBiz);
    }

    #[test]
    fn variant_name_mapping() {
        assert_eq!(Plan::from_variant_name("Personal Monthly"), Plan::Personal);
        assert_eq!(Plan::from_variant_name("Solo Biz Yearly"), Plan::SoloBiz);
        assert_eq!(Plan::from_variant_name("Business Plan"), Plan::Business);
        assert_eq!(Plan::from_variant_name("Enterprise"), Plan::Enterprise);
    }

    #[test]
    fn parse_iso_date() {
        // 2027-03-01 = 2027-01-01 (day 20819 from epoch) + 31 (Jan) + 28 (Feb) = day 20878
        // 20878 * 86400 = 1803859200
        assert_eq!(parse_iso_to_unix("2027-03-01T00:00:00.000000Z"), Some(1803859200));
        assert_eq!(parse_iso_to_unix("2027-03-01"), Some(1803859200));
        // 2026-03-01 = day 20513, 20513 * 86400 = 1772323200
        assert_eq!(parse_iso_to_unix("2026-03-01"), Some(1772323200));
    }

    #[test]
    fn parse_iso_null_like() {
        assert_eq!(parse_iso_to_unix(""), None);
        assert_eq!(parse_iso_to_unix("null"), None);
    }
}

