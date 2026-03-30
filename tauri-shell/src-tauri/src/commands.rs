use crate::engine::{EngineConfig, EngineManager};
use crate::license::{self, LicenseStatus};
use tauri::{State, Window};

// ── Engine commands ───────────────────────────────────────────────────────────

/// Get the current engine configuration
#[tauri::command]
pub async fn get_engine_config(
    engine: State<'_, EngineManager>,
) -> Result<Option<EngineConfig>, String> {
    Ok(engine.get_config())
}

/// Start the engine using the currently activated license plan.
#[tauri::command]
pub async fn start_engine(
    engine: State<'_, EngineManager>,
    window: Window,
) -> Result<EngineConfig, String> {
    if engine.is_running() {
        return engine.get_config()
            .ok_or_else(|| "Engine is running but config unavailable".to_string());
    }
    let status = license::read_license();
    let plan = if status.is_active { status.plan } else { crate::license::Plan::Free };
    engine.start_with_plan(window, &plan).map_err(|e| e.to_string())
}

/// Stop the engine
#[tauri::command]
pub async fn stop_engine(engine: State<'_, EngineManager>) -> Result<(), String> {
    engine.stop().map_err(|e| e.to_string())
}

/// Check if engine is running
#[tauri::command]
pub async fn is_engine_running(engine: State<'_, EngineManager>) -> Result<bool, String> {
    Ok(engine.is_running())
}

/// Restart the engine, picking up any license changes.
#[tauri::command]
pub async fn restart_engine(
    engine: State<'_, EngineManager>,
    window: Window,
) -> Result<EngineConfig, String> {
    if engine.is_running() {
        engine.stop().map_err(|e| e.to_string())?;
    }
    let status = license::read_license();
    let plan = if status.is_active { status.plan } else { crate::license::Plan::Free };
    engine.start_with_plan(window, &plan).map_err(|e| e.to_string())
}

// ── License commands ──────────────────────────────────────────────────────────

/// Get the current license status (plan, expiry, etc.).
/// Safe to call any time — reads local file only, no network.
#[tauri::command]
pub async fn get_license_status() -> Result<LicenseStatus, String> {
    Ok(license::read_license())
}

/// Activate a LemonSqueezy license key.
/// Contacts LemonSqueezy API to validate and record the activation.
#[tauri::command]
pub async fn activate_license(key: String) -> Result<LicenseStatus, String> {
    let key = key.trim().to_uppercase();
    // Basic format guard: printable ASCII only, reasonable length bounds,
    // must contain at least one dash (LemonSqueezy key format).
    if key.len() < 10 || key.len() > 128 {
        return Err("Invalid license key length.".to_string());
    }
    if !key.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return Err("License key contains invalid characters.".to_string());
    }
    if !key.contains('-') {
        return Err("Invalid license key format.".to_string());
    }
    // Run blocking HTTP call off the async runtime thread
    tokio::task::spawn_blocking(move || license::activate_license(&key))
        .await
        .map_err(|e| format!("Task error: {}", e))?
}

/// Deactivate the current license (releases the activation slot on LemonSqueezy).
#[tauri::command]
pub async fn deactivate_license() -> Result<(), String> {
    tokio::task::spawn_blocking(license::deactivate_license)
        .await
        .map_err(|e| format!("Task error: {}", e))?
}

/// Re-validate the license with LemonSqueezy.
/// Should be called when `needs_verification` is true (once per week).
#[tauri::command]
pub async fn verify_license_online() -> Result<LicenseStatus, String> {
    tokio::task::spawn_blocking(license::verify_online)
        .await
        .map_err(|e| format!("Task error: {}", e))?
}

// ── Local API commands ────────────────────────────────────────────────────────

/// Local API connection info for the running engine session.
#[derive(serde::Serialize)]
pub struct LocalApiInfo {
    /// HTTP port the engine is listening on (changes each restart).
    pub port: u16,
    /// Per-session Bearer token (changes each restart).
    pub session_token: String,
    /// Persistent Bearer token — stable across restarts (Business+ feature).
    pub api_key: String,
    /// Full base URL, e.g. "http://127.0.0.1:53421".
    pub base_url: String,
    /// Filesystem path of local-api-key.txt (for user reference).
    pub api_key_file: String,
    /// Filesystem path of api-session.json (for external programs).
    pub session_file: String,
}

/// Return the current engine endpoint and both auth tokens.
/// The `api_key` is stable across restarts; `session_token` changes each run.
#[tauri::command]
pub async fn get_local_api_info(
    engine: State<'_, EngineManager>,
) -> Result<Option<LocalApiInfo>, String> {
    let config = match engine.get_config() {
        Some(c) => c,
        None => return Ok(None),
    };
    let dir = license::app_data_dir();
    let api_key = std::fs::read_to_string(dir.join("local-api-key.txt"))
        .map(|s| s.trim().to_string())
        .unwrap_or_default();
    Ok(Some(LocalApiInfo {
        port: config.port,
        session_token: config.token,
        api_key,
        base_url: config.base_url,
        api_key_file: dir.join("local-api-key.txt").to_string_lossy().into_owned(),
        session_file: dir.join("api-session.json").to_string_lossy().into_owned(),
    }))
}

/// Generate a new persistent API key and save it to disk.
/// The new key takes effect after the next app restart.
#[tauri::command]
pub async fn regenerate_local_api_key() -> Result<String, String> {
    let dir = license::app_data_dir();
    let path = dir.join("local-api-key.txt");
    let _ = std::fs::remove_file(&path); // delete old key
    let new_key = crate::engine::generate_fresh_token();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    std::fs::write(&path, &new_key).map_err(|e| e.to_string())?;
    Ok(new_key)
}

// ── Data export / import ──────────────────────────────────────────────────────

/// Export user overlay data to a JSON file at the given path.
/// Calls the engine's /user/hexagons endpoint and writes the response to disk.
#[tauri::command]
pub async fn export_user_data(
    engine: State<'_, EngineManager>,
    dest_path: String,
) -> Result<u32, String> {
    let config = engine
        .get_config()
        .ok_or("Engine is not running. Start the app first.")?;

    let client = reqwest::Client::new();
    let response = client
        .get(format!("{}/user/hexagons", config.base_url))
        .bearer_auth(&config.token)
        .send()
        .await
        .map_err(|e| format!("Failed to reach engine: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("Engine returned error: {}", response.status()));
    }

    let body = response
        .bytes()
        .await
        .map_err(|e| format!("Failed to read response: {}", e))?;

    // Parse to count entries and validate JSON
    let parsed: serde_json::Value = serde_json::from_slice(&body)
        .map_err(|e| format!("Invalid JSON from engine: {}", e))?;

    let count = parsed
        .get("overlays")
        .and_then(|o| o.as_object())
        .map(|m| m.len() as u32)
        .unwrap_or(0);

    // Wrap in export envelope with metadata
    let export = serde_json::json!({
        "export_version": 1,
        "exported_at": chrono::Utc::now().to_rfc3339(),
        "overlay_count": count,
        "data": parsed
    });

    // Validate destination path using canonicalization of the parent directory.
    // This prevents path traversal (../, symlinks, etc.) regardless of OS.
    let dest = std::path::Path::new(&dest_path);
    let dest_abs = if dest.is_absolute() {
        dest.to_path_buf()
    } else {
        std::env::current_dir().map_err(|e| e.to_string())?.join(dest)
    };
    // Ensure parent directory exists and resolve symlinks
    let parent = dest_abs.parent().ok_or("Invalid export path: no parent directory")?;
    std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let canonical_parent = std::fs::canonicalize(parent)
        .map_err(|_| "Invalid export path: parent directory is not accessible".to_string())?;
    let filename = dest_abs.file_name().ok_or("Invalid export path: no filename")?;
    let canonical_dest = canonical_parent.join(filename);
    // Block writes to OS-sensitive directories after canonicalization
    let dest_str = canonical_dest.to_string_lossy().replace('\\', "/").to_lowercase();
    if dest_str.contains("/etc/") || dest_str.contains("/usr/") || dest_str.contains("windows/system32") {
        return Err("Export to system directories is not allowed".to_string());
    }

    std::fs::write(&canonical_dest, serde_json::to_vec_pretty(&export).map_err(|e| e.to_string())?)
        .map_err(|e| format!("Failed to write export file: {}", e))?;

    Ok(count)
}

/// Import user overlay data from a previously exported JSON file.
/// Sends the overlays to the engine via the bulk overlay endpoint.
#[tauri::command]
pub async fn import_user_data(
    engine: State<'_, EngineManager>,
    src_path: String,
) -> Result<u32, String> {
    let config = engine
        .get_config()
        .ok_or("Engine is not running. Start the app first.")?;

    // Canonicalize the source path to resolve symlinks and .. segments,
    // preventing path traversal attacks regardless of how the input is crafted.
    let canonical_src = std::fs::canonicalize(&src_path)
        .map_err(|_| "Import file does not exist or path is invalid".to_string())?;
    let src_str = canonical_src.to_string_lossy().replace('\\', "/").to_lowercase();
    if src_str.contains("/etc/") || src_str.contains("/usr/bin") || src_str.contains("windows/system32") {
        return Err("Import from system directories is not allowed".to_string());
    }

    let metadata = std::fs::metadata(&canonical_src).map_err(|e| format!("Cannot read file: {}", e))?;
    if metadata.len() > 50 * 1024 * 1024 {
        return Err("Import file too large (max 50 MB)".to_string());
    }

    let file_bytes =
        std::fs::read(&canonical_src).map_err(|e| format!("Cannot read import file: {}", e))?;

    let envelope: serde_json::Value = serde_json::from_slice(&file_bytes)
        .map_err(|e| format!("Invalid import file format: {}", e))?;

    // Support both direct overlay format and the export envelope format
    let data = if envelope.get("export_version").is_some() {
        envelope
            .get("data")
            .cloned()
            .ok_or("Export file missing 'data' field")?
    } else {
        envelope
    };

    let overlays = data
        .get("overlays")
        .ok_or("Import file missing 'overlays' field")?;

    let count = overlays
        .as_object()
        .map(|m| m.len() as u32)
        .unwrap_or(0);

    if count == 0 {
        return Ok(0);
    }

    // Build bulk payload: { "overlays": { "h3_hex": [u32; 7], ... } }
    let bulk_payload = serde_json::json!({ "overlays": overlays });

    let client = reqwest::Client::new();
    let response = client
        .post(format!("{}/user/hexagons/bulk", config.base_url))
        .bearer_auth(&config.token)
        .json(&bulk_payload)
        .send()
        .await
        .map_err(|e| format!("Failed to reach engine: {}", e))?;

    if !response.status().is_success() {
        return Err(format!(
            "Engine rejected import ({}): {}",
            response.status(),
            response.text().await.unwrap_or_default()
        ));
    }

    Ok(count)
}

// ── DB distribution / setup ──────────────────────────────────────────────────

/// Status of the local hex database files.
#[derive(serde::Serialize)]
pub struct DbStatus {
    /// Whether hexagons.edbh is present in the expected app-data location.
    pub hex_db_present: bool,
    /// Size in bytes of hexagons.edbh, or 0 if not present.
    pub hex_db_bytes: u64,
    /// Path where DB files are expected (for display purposes).
    pub db_dir: String,
}

/// Returns whether the hex vector database is present and its size.
/// Used by the frontend to decide whether to show the DB setup screen.
#[tauri::command]
pub async fn check_db_status() -> Result<DbStatus, String> {
    let dir = license::app_data_dir().join("eodi");
    let db_path = dir.join("hexagons.edbh");
    let (present, bytes) = match std::fs::metadata(&db_path) {
        Ok(m) => (m.len() > 1_000_000, m.len()), // >1MB = valid file
        Err(_) => (false, 0),
    };
    Ok(DbStatus {
        hex_db_present: present,
        hex_db_bytes: bytes,
        db_dir: dir.to_string_lossy().into_owned(),
    })
}

/// Download a single DB file from the given URL to the app-data DB directory.
/// Emits `db-download-progress` events: `{ file, pct: 0–100, bytes_done, bytes_total }`.
/// Verifies SHA-256 after download if `expected_sha256` is provided (hex string).
#[tauri::command]
pub async fn download_db_file(
    window: tauri::Window,
    url: String,
    filename: String,
    expected_sha256: Option<String>,
) -> Result<String, String> {
    use sha2::{Digest, Sha256};
    use std::io::Write;

    // Sanitize filename — only allow simple filenames with known extensions
    if filename.contains('/') || filename.contains('\\') || filename.contains("..") {
        return Err("Invalid filename".to_string());
    }
    let allowed_exts = [".edbh", ".edb", ".edbh.adm"];
    if !allowed_exts.iter().any(|e| filename.ends_with(e)) {
        return Err("Unsupported file extension".to_string());
    }

    // Only allow downloads from GitHub Releases (safety guard)
    if !url.starts_with("https://github.com/")
        && !url.starts_with("https://objects.githubusercontent.com/")
    {
        return Err("Only GitHub Releases downloads are permitted".to_string());
    }

    let dir = license::app_data_dir().join("eodi");
    std::fs::create_dir_all(&dir).map_err(|e| format!("Cannot create DB dir: {}", e))?;
    let dest_path = dir.join(&filename);
    let tmp_path = dir.join(format!("{}.tmp", filename));

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(3600))
        .build()
        .map_err(|e| e.to_string())?;

    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Download failed: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("Server returned {}", response.status()));
    }

    let total = response.content_length().unwrap_or(0);
    let bytes_full = response
        .bytes()
        .await
        .map_err(|e| format!("Download error: {}", e))?;

    // Verify SHA-256 before writing
    if let Some(expected) = expected_sha256 {
        let mut h = Sha256::new();
        h.update(&bytes_full);
        let actual = format!("{:x}", h.finalize());
        if !actual.eq_ignore_ascii_case(&expected) {
            return Err(format!(
                "SHA-256 mismatch: expected {}, got {}",
                expected, actual
            ));
        }
    }

    // Write to tmp then rename (atomic)
    {
        let mut tmp_file =
            std::fs::File::create(&tmp_path).map_err(|e| format!("Cannot create tmp file: {}", e))?;
        tmp_file
            .write_all(&bytes_full)
            .map_err(|e| format!("Write error: {}", e))?;
    }
    std::fs::rename(&tmp_path, &dest_path)
        .map_err(|e| format!("Failed to finalize file: {}", e))?;

    window
        .emit(
            "db-download-progress",
            serde_json::json!({
                "file": filename,
                "pct": 100u8,
                "bytes_done": bytes_full.len() as u64,
                "bytes_total": total,
            }),
        )
        .ok();

    Ok(dest_path.to_string_lossy().into_owned())
}
