use crate::license::Plan;
use hmac::{Hmac, Mac};
use sha2::Sha256;
use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use tauri::Window;
use thiserror::Error;
use tracing::{error, info, warn};

type HmacSha256 = Hmac<Sha256>;

/// Shared key used to sign the plan token passed to the engine.
/// Both the Tauri shell (signer) and the engine binary (verifier) embed this key.
/// Symbol names are stripped in release builds.
const PLAN_TOKEN_KEY: &[u8] = &[
    0xd3, 0x7f, 0x2a, 0x91, 0x5c, 0xe0, 0x48, 0xb6,
    0x1e, 0x84, 0xa3, 0x69, 0xf7, 0x0b, 0xc5, 0x32,
    0x9e, 0x57, 0x6d, 0x4a, 0xb0, 0x23, 0x8f, 0xe4,
    0x71, 0xcc, 0x15, 0x3b, 0x87, 0xa9, 0x5e, 0x02,
];

#[derive(Debug, Error)]
pub enum EngineError {
    #[error("Failed to start engine: {0}")]
    StartFailed(String),
    #[error("Engine not running")]
    NotRunning,
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EngineConfig {
    pub base_url: String,
    pub token: String,
    pub port: u16,
}

pub struct EngineManager {
    pub process: Arc<Mutex<Option<Child>>>,
    pub config: Arc<Mutex<Option<EngineConfig>>>,
}

impl EngineManager {
    pub fn new() -> Self {
        Self {
            process: Arc::new(Mutex::new(None)),
            config: Arc::new(Mutex::new(None)),
        }
    }

    /// Start the Rust engine. Blocks until ENGINE_READY or error.
    pub fn start(&self, window: Window) -> Result<EngineConfig, EngineError> {
        self.start_with_plan(window, &Plan::Free)
    }

    /// Start the Rust engine with an explicit plan flag passed to the engine binary.
    ///
    /// The engine uses this to enforce Pro-only endpoints (`/hex/match`, `/hex/discover`).
    pub fn start_with_plan(&self, window: Window, plan: &Plan) -> Result<EngineConfig, EngineError> {
        let engine_path = find_engine_binary()?;
        info!("Engine binary: {:?}", engine_path);

        let hexdb_path = find_hexdb_path(&engine_path);
        info!("Hex database: {}", hexdb_path);

        let token = generate_token();
        let plan_token = sign_plan_token(plan.as_str());
        let api_key = load_or_create_api_key();

        let mut cmd = Command::new(&engine_path);
        // argv[1] = hexdb_path, argv[2] = token, argv[3] = --plan-token=<signed>, argv[4] = --api-key=<persistent>
        cmd.args([hexdb_path.as_str(), token.as_str(), &format!("--plan-token={}", plan_token), &format!("--api-key={}", api_key)]);
        cmd.stdout(Stdio::piped());
        #[cfg(debug_assertions)]
        cmd.stderr(Stdio::inherit());
        #[cfg(not(debug_assertions))]
        cmd.stderr(Stdio::null());
        hide_window(&mut cmd);

        let mut child = cmd.spawn().map_err(|e| {
            error!("Failed to spawn engine: {}", e);
            EngineError::StartFailed(e.to_string())
        })?;

        let stdout = child.stdout.take().ok_or_else(|| {
            error!("Engine stdout was not captured — check Stdio::piped() is set");
            EngineError::StartFailed("stdout not captured".into())
        })?;
        let reader = BufReader::new(stdout);

        let mut port: Option<u16> = None;
        let mut actual_token = token.clone();
        let mut lines_iter = reader.lines();

        // Stage 1: wait for ENGINE_SERVER_UP (< 200ms) — server is up, UI can show
        loop {
            match lines_iter.next() {
                None => break,
                Some(Err(e)) => { error!("Error reading engine stdout: {}", e); break; }
                Some(Ok(line)) => {
                    if let Some(p) = line.strip_prefix("ENGINE_PORT=") {
                        port = p.trim().parse().ok();
                        info!("Engine port: {:?}", port);
                    } else if let Some(t) = line.strip_prefix("ENGINE_TOKEN=") {
                        actual_token = t.trim().to_string();
                    } else if line.trim() == "ENGINE_SERVER_UP" {
                        info!("Engine server up, emitting engine-ready");
                        break;
                    } else if line.trim() == "ENGINE_READY" {
                        // Fallback: old binary without ENGINE_SERVER_UP
                        info!("Engine ready (legacy signal)");
                        window.emit("engine-progress", 100u8).ok();
                        break;
                    }
                }
            }
        }

        let port = port.ok_or_else(|| {
            EngineError::StartFailed("ENGINE_PORT never received".into())
        })?;

        *self.process.lock().unwrap_or_else(|e| {
            error!("process Mutex poisoned — recovering");
            e.into_inner()
        }) = Some(child);

        let config = EngineConfig {
            base_url: format!("http://127.0.0.1:{}", port),
            token: actual_token,
            port,
        };
        *self.config.lock().unwrap_or_else(|e| {
            error!("config Mutex poisoned — recovering");
            e.into_inner()
        }) = Some(config.clone());

        // Write api-session.json so external tools can discover port + tokens
        write_api_session(config.port, &config.token, &api_key);

        // Emit engine-ready NOW — UI appears immediately
        window.emit("engine-ready", &config).ok();

        // Stage 2: continue reading stdout in background for VDB loading progress
        let win2 = window.clone();
        std::thread::spawn(move || {
            for line in lines_iter {
                let line = match line { Ok(l) => l, Err(_) => break };
                if let Some(pct) = line.strip_prefix("ENGINE_LOADING=") {
                    if let Ok(n) = pct.trim().parse::<u8>() {
                        win2.emit("engine-progress", n).ok();
                    }
                } else if line.trim() == "ENGINE_READY" {
                    info!("VDB fully loaded — emitting engine-loaded");
                    win2.emit("engine-progress", 100u8).ok();
                    win2.emit("engine-loaded", true).ok();
                }
            }
        });

        info!("Engine started on port {}", port);
        Ok(config)
    }

    pub fn stop(&self) -> Result<(), EngineError> {
        info!("Stopping engine...");
        let mut proc = self.process.lock().unwrap_or_else(|e| {
            error!("process Mutex poisoned — recovering");
            e.into_inner()
        });
        if let Some(mut child) = proc.take() {
            // Try graceful shutdown: check if already exited
            match child.try_wait() {
                Ok(Some(_status)) => {
                    info!("Engine already exited");
                }
                _ => {
                    // Still running — force kill (Windows doesn't support SIGTERM)
                    if let Err(e) = child.kill() {
                        warn!("Failed to kill engine: {}", e);
                    }
                    match child.wait() {
                        Ok(status) => info!("Engine stopped (exit: {})", status),
                        Err(e) => warn!("Engine wait error: {}", e),
                    }
                }
            }
        } else {
            return Err(EngineError::NotRunning);
        }
        *self.config.lock().unwrap_or_else(|e| {
            error!("config Mutex poisoned — recovering");
            e.into_inner()
        }) = None;
        Ok(())
    }

    pub fn get_config(&self) -> Option<EngineConfig> {
        self.config.lock().unwrap_or_else(|e| {
            error!("config Mutex poisoned — recovering");
            e.into_inner()
        }).clone()
    }

    pub fn is_running(&self) -> bool {
        self.process.lock().unwrap_or_else(|e| {
            error!("process Mutex poisoned — recovering");
            e.into_inner()
        }).is_some()
    }
}

impl Drop for EngineManager {
    fn drop(&mut self) {
        let _ = self.stop();
    }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

fn find_engine_binary() -> Result<PathBuf, EngineError> {
    // 1. Sidecar: next to the running executable (production)
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let sidecar = dir.join("eodi-engine.exe");
            if sidecar.exists() {
                return Ok(sidecar);
            }
        }
    }
    // 2. Dev workspace paths
    let mut dev_candidates = vec![
        // Tauri tauri.conf.json externalBin: "binaries/eodi-engine"
        // Tauri appends the target triple, e.g. eodi-engine-x86_64-pc-windows-msvc.exe
        format!("binaries/eodi-engine-{}.exe", std::env::consts::ARCH),
        "binaries/eodi-engine.exe".to_string(),
        "engine-server/target/release/eodi-engine.exe".to_string(),
        "../engine-server/target/release/eodi-engine.exe".to_string(),
        "../../engine-server/target/release/eodi-engine.exe".to_string(),
        "go-api/engine/eodi-engine.exe".to_string(),
        "../go-api/engine/eodi-engine.exe".to_string(),
        "../../go-api/engine/eodi-engine.exe".to_string(),
        "eodi-engine.exe".to_string(),
    ];
    // Also check relative to current exe
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let triple = format!("eodi-engine-{}-pc-windows-msvc.exe", std::env::consts::ARCH);
            dev_candidates.insert(0, dir.join(&triple).to_string_lossy().into_owned());
        }
    }
    for rel in &dev_candidates {
        let p = PathBuf::from(rel.as_str());
        if p.exists() {
            return Ok(p);
        }
    }
    Err(EngineError::StartFailed(
        "eodi-engine.exe not found. Build engine-server first.".into(),
    ))
}

fn find_hexdb_path(engine_binary: &PathBuf) -> String {
    #[cfg(target_os = "windows")]
    if let Ok(app_data) = std::env::var("APPDATA") {
        let p = PathBuf::from(&app_data).join("eodi").join("hexagons.edbh");
        if p.exists() {
            return p.to_string_lossy().into_owned();
        }
    }
    if let Some(engine_dir) = engine_binary.parent() {
        for name in ["hexagons.edbh", "data/hexagons.edbh"] {
            let p = engine_dir.join(name);
            if p.exists() {
                return p.to_string_lossy().into_owned();
            }
        }
    }
    let dev_candidates = [
        "output/hexagons.edbh",
        "../output/hexagons.edbh",
        "../../output/hexagons.edbh",
        "go-api/data/hexagons.edbh",
        "../go-api/data/hexagons.edbh",
        "data/hexagons.edbh",
    ];
    for rel in &dev_candidates {
        let p = PathBuf::from(rel);
        if p.exists() {
            return p.to_string_lossy().into_owned();
        }
    }
    warn!("hexagons.edbh not found, engine will use its own fallback");
    "data/hexagons.edbh".to_string()
}

fn generate_token() -> String {
    use rand::RngCore;
    let mut bytes = [0u8; 32];
    rand::rngs::OsRng.fill_bytes(&mut bytes);
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

/// Public re-export for use in commands.rs.
pub fn generate_fresh_token() -> String {
    generate_token()
}

/// Load the persistent local API key from disk, or generate and save a new one.
/// The persistent key survives app restarts, making it easy for external tools
/// to configure once and reuse without reading api-session.json every time.
pub fn load_or_create_api_key() -> String {
    let dir = crate::license::app_data_dir();
    let path = dir.join("local-api-key.txt");
    if let Ok(key) = std::fs::read_to_string(&path) {
        let key = key.trim().to_string();
        if key.len() == 64 && key.chars().all(|c| c.is_ascii_hexdigit()) {
            return key;
        }
    }
    let key = generate_token();
    let _ = std::fs::create_dir_all(&dir);
    let _ = std::fs::write(&path, &key);
    key
}

/// Write api-session.json to the app data directory.
/// External programs read this file to discover the current port and tokens.
/// Format mirrors Jupyter's nbserver-*.json convention.
fn write_api_session(port: u16, session_token: &str, api_key: &str) {
    let dir = crate::license::app_data_dir();
    let _ = std::fs::create_dir_all(&dir);
    let path = dir.join("api-session.json");
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let json = format!(
        r#"{{"port":{port},"session_token":"{session_token}","api_key":"{api_key}","base_url":"http://127.0.0.1:{port}","started_at_unix":{now}}}"#,
        port = port,
        session_token = session_token,
        api_key = api_key,
        now = now,
    );
    if let Err(e) = std::fs::write(&path, json) {
        warn!("Failed to write api-session.json: {}", e);
    }
}

/// Sign a plan tier + current minute timestamp using HMAC-SHA256.
/// Format: `base64(HMAC(plan_str + ":" + unix_minute))`.
/// The engine verifies this within a ±5 minute window.
fn sign_plan_token(plan: &str) -> String {
    use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
    let ts_minute = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
        / 60;
    let payload = format!("{}:{}", plan, ts_minute);
    // PLAN_TOKEN_KEY is a non-empty compile-time constant; HMAC-SHA256 accepts any key length.
    // Use if-let to avoid a potential panic in case the constant is ever changed to zero-length.
    let Ok(mut mac) = HmacSha256::new_from_slice(PLAN_TOKEN_KEY) else {
        return format!("{}:{}:err", plan, ts_minute);
    };
    mac.update(payload.as_bytes());
    let sig = B64.encode(mac.finalize().into_bytes());
    // Token format: "plan:ts_minute:sig" (all URL-safe base64 chars)
    format!("{}:{}:{}", plan, ts_minute, sig)
}

#[cfg(target_os = "windows")]
fn hide_window(cmd: &mut Command) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;
    cmd.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(target_os = "windows"))]
fn hide_window(_cmd: &mut Command) {}
