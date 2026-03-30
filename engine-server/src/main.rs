//! EODI.ME Engine Server — Secure Encrypted Hex Vector Database API
//!
//! Standalone HTTP server that:
//! 1. Decrypts .edbh files using compile-time embedded AES-256-GCM key
//! 2. Loads all hexagon vectors into memory with pre-computed search indices
//! 3. Serves hex search/match/detail/stats endpoints on 127.0.0.1 (localhost only)
//! 4. Authenticates all requests via Bearer token (constant-time comparison)
//!
//! # Security Model
//! - AES key exists only inside the compiled binary
//! - Binds exclusively to 127.0.0.1 — no external network access
//! - Per-session auth token (CSPRNG) prevents unauthorized local queries
//! - Constant-time token comparison prevents timing side-channels
//! - Plan tier verified via HMAC-SHA256 signed token (prevents CLI spoofing)
//! - Release binary: symbols stripped, LTO enabled, panic=abort
//! - Plaintext zeroized from memory after deserialization

mod crypto;
mod math;
mod models;
mod overlay;
mod search;

use axum::{
    extract::{DefaultBodyLimit, Path, Query, State},
    http::{header, HeaderMap, HeaderValue, StatusCode},
    middleware::{self, Next},
    response::Json,
    routing::{delete, get, post},
    Router,
};
use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use hmac::{Hmac, Mac};
use serde::Deserialize;
use sha2::Sha256;
use std::io::Write;
use std::net::SocketAddr;
use std::sync::atomic::{AtomicU64, AtomicU8, Ordering};
use std::sync::{Arc, OnceLock};
use tokio::net::TcpListener;

type HmacSha256 = Hmac<Sha256>;

// ─────────────────────────────────────────────────────────────────────────────
// Plan token verification key — XOR-split for binary protection.
// Must match the reconstruction in tauri-shell/src-tauri/src/engine.rs.
// ─────────────────────────────────────────────────────────────────────────────

// Plan token key — XOR-split at rest, reconstructed inline at first use.
// Neither array alone encodes the secret.
const _PTM: &[u8] = &[
    0xa0, 0xe0, 0xbf, 0xd5, 0xd7, 0xd5, 0x82, 0x49,
    0xac, 0x97, 0x02, 0x9a, 0x21, 0x0e, 0x3e, 0x9e,
    0x4a, 0xf8, 0xfb, 0x3e, 0x32, 0x4d, 0x72, 0xc0,
    0x79, 0x26, 0x4b, 0x88, 0x1e, 0x96, 0x1f, 0x23,
];
const _PTD: &[u8] = &[
    0x73, 0x9f, 0x95, 0x44, 0x8b, 0x35, 0xca, 0xff,
    0xb2, 0x13, 0xa1, 0xf3, 0xd6, 0x05, 0xfb, 0xac,
    0xd4, 0xaf, 0x96, 0x74, 0x82, 0x6e, 0xfd, 0x24,
    0x08, 0xea, 0x5e, 0xb3, 0x99, 0x3f, 0x41, 0x21,
];

#[inline(never)]
fn plan_token_key() -> [u8; 32] {
    let mut k = [0u8; 32];
    for i in 0..32 { k[i] = _PTD[i] ^ _PTM[i]; }
    k
}

// ─────────────────────────────────────────────────────────────────────────────
// Application state
// ─────────────────────────────────────────────────────────────────────────────

struct AppState {
    hex_index: OnceLock<search::HexIndex>,
    load_progress: AtomicU8,
    auth_token: String,
    /// Persistent API key from `--api-key=` CLI arg. Accepted alongside the ephemeral
    /// session token so external tools work across app restarts.
    api_key: Option<String>,
    /// User POI overlays — separate from the immutable hex VDB.
    user_overlay: overlay::UserOverlayStore,
    /// Active plan. Pro unlocks /hex/match and /hex/discover.
    plan: Plan,
    /// Rate limiting: packed u64 = (unix_second << 32) | request_count_in_window.
    /// Allows MAX_REQ_PER_SECOND global requests per second before returning HTTP 429.
    rate_bucket: AtomicU64,
    /// True when bound to a non-loopback address (server/Docker mode).
    /// CORS is open in this mode — the API key is the sole auth guard.
    server_mode: bool,
}

impl AppState {
    fn idx(&self) -> Option<&search::HexIndex> {
        self.hex_index.get()
    }
}

/// Plan tier verified from the HMAC-signed `--plan-token=` CLI argument.
/// Falls back to Free on any verification failure.
#[derive(Clone, PartialEq, Eq)]
enum Plan {
    Free,
    Pro,
}

impl Plan {
    /// Parse and verify a signed plan token (`--plan-token=plan:ts_minute:sig`).
    /// Falls back to `--plan=` (legacy, unverified) if no token is present.
    fn from_args(args: &[String]) -> Self {
        // 1. Try verified plan token
        for arg in args {
            if let Some(token) = arg.strip_prefix("--plan-token=") {
                return Self::verify_plan_token(token);
            }
        }
        // 2. Legacy fallback (no signature — treated as Free for security)
        tracing::warn!("No --plan-token provided, defaulting to Free tier");
        Plan::Free
    }

    fn verify_plan_token(token: &str) -> Self {
        let parts: Vec<&str> = token.splitn(3, ':').collect();
        if parts.len() != 3 {
            tracing::warn!("Malformed plan token");
            return Plan::Free;
        }
        let plan_str = parts[0];
        let ts_minute: u64 = match parts[1].parse() {
            Ok(v) => v,
            Err(_) => {
                tracing::warn!("Plan token: invalid timestamp");
                return Plan::Free;
            }
        };
        let sig_b64 = parts[2];

        // Verify timestamp is within ±5 minutes
        let now_minute = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs()
            / 60;
        if now_minute.abs_diff(ts_minute) > 5 {
            tracing::warn!("Plan token timestamp out of range (replay protection)");
            return Plan::Free;
        }

        // Verify HMAC
        let payload = format!("{}:{}", plan_str, ts_minute);
        let key = plan_token_key();
        let mut mac = HmacSha256::new_from_slice(&key).expect("key");
        mac.update(payload.as_bytes());
        let expected_sig = B64.encode(mac.finalize().into_bytes());

        // Constant-time comparison
        let valid = expected_sig.len() == sig_b64.len()
            && expected_sig
                .bytes()
                .zip(sig_b64.bytes())
                .fold(0u8, |acc, (a, b)| acc | (a ^ b))
                == 0;

        if !valid {
            tracing::warn!("Plan token HMAC verification failed — possible tampering");
            return Plan::Free;
        }

        // Map plan string to tier
        match plan_str {
            "personal" | "solo_biz" | "business" | "enterprise" => {
                tracing::info!("Plan token verified: {} → Pro", plan_str);
                Plan::Pro
            }
            _ => Plan::Free,
        }
    }

    /// Return HTTP 402 if the current plan does not meet the required tier.
    fn require_pro(&self) -> Result<(), StatusCode> {
        if *self == Plan::Pro {
            Ok(())
        } else {
            Err(StatusCode::PAYMENT_REQUIRED)
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/// Maximum search query length (bytes). Prevents abuse via huge payloads.
const MAX_QUERY_LEN: usize = 500;
/// Maximum results from search/match endpoints.
const MAX_RESULT_LIMIT: usize = 5000;
/// Maximum request body size (bytes) for POST/PUT endpoints.
const MAX_BODY_BYTES: usize = 1024 * 1024; // 1 MB
/// Maximum authenticated requests per second (global). Defends against runaway loops.
const MAX_REQ_PER_SECOND: u32 = 300;

// ─────────────────────────────────────────────────────────────────────────────
// Entry point
// ─────────────────────────────────────────────────────────────────────────────

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info".into()),
        )
        .with_target(false)
        .with_writer(std::io::stderr)
        .init();

    // Parse CLI: eodi-engine <hexdb_path> [token]
    let args: Vec<String> = std::env::args().collect();

    let hexdb_path = args.get(1).cloned().unwrap_or_else(|| {
        // Prefer exe-relative paths for production deployment
        let exe_dir = std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(|d| d.to_path_buf()));

        let mut candidates: Vec<std::path::PathBuf> = Vec::new();
        if let Some(ref dir) = exe_dir {
            candidates.push(dir.join("hexagons.edbh"));
            candidates.push(dir.join("data").join("hexagons.edbh"));
        }
        candidates.extend([
            "data/hexagons.edbh".into(),
            "hexagons.edbh".into(),
            "../data/hexagons.edbh".into(),
            "../output/hexagons.edbh".into(),
            "output/hexagons.edbh".into(),
        ]);

        for c in &candidates {
            if c.exists() {
                return c.to_string_lossy().to_string();
            }
        }
        "data/hexagons.edbh".to_string()
    });

    let auth_token = args
        .get(2)
        .cloned()
        .or_else(|| std::env::var("ENGINE_TOKEN").ok())
        .unwrap_or_else(generate_token);

    // Optional persistent API key for stable external integrations (--api-key=<hex>).
    // Accepted alongside the ephemeral session token in the auth middleware.
    let api_key: Option<String> = args.iter()
        .find_map(|a| a.strip_prefix("--api-key=").map(String::from));

    // Bind address: --bind=<addr> (default 127.0.0.1 for desktop, 0.0.0.0 for server/Docker)
    let bind_addr: std::net::IpAddr = args.iter()
        .find_map(|a| a.strip_prefix("--bind=").and_then(|v| v.parse().ok()))
        .unwrap_or(std::net::IpAddr::V4(std::net::Ipv4Addr::new(127, 0, 0, 1)));

    // In server mode (non-loopback), require an explicit api-key — no unauthenticated access.
    let is_server_mode = !bind_addr.is_loopback();
    if is_server_mode && api_key.is_none() {
        tracing::error!("Server mode (--bind=0.0.0.0) requires --api-key=<hex>. Refusing to start without auth.");
        std::process::exit(1);
    }

    // Verify HMAC-signed plan token from Tauri shell
    let plan = Plan::from_args(&args);
    let plan_label = if plan == Plan::Pro { "pro" } else { "free" };

    // Load user overlay (separate from immutable hex VDB — loads fast)
    let user_overlay = overlay::UserOverlayStore::new(std::path::Path::new(&hexdb_path));

    // Build state with empty hex_index
    let state = Arc::new(AppState {
        hex_index: OnceLock::new(),
        load_progress: AtomicU8::new(0),
        auth_token: auth_token.clone(),
        api_key,
        user_overlay,
        plan,
        rate_bucket: AtomicU64::new(0),
        server_mode: is_server_mode,
    });

    let app = Router::new()
        .route("/health", get(health_handler))
        .route("/engine/health", get(engine_health_handler))
        .route("/search", get(hex_search_handler))
        .route("/hex/search", get(hex_search_handler))
        .route("/hex/match", get(hex_match_handler))
        .route("/hex/viewport", get(hex_viewport_handler))
        .route("/hex/discover", get(hex_discover_handler))
        .route("/hex/nearest", get(hex_nearest_handler))
        .route("/hex/:h3", get(hex_detail_handler))
        .route("/stats", get(stats_handler))
        .route("/countries", get(countries_handler))
        .route("/cities", get(cities_handler))
        // User overlay endpoints (separate from immutable hex VDB)
        .route("/user/hex/:h3", get(user_overlay_get_handler)
            .put(user_overlay_set_handler)
            .delete(user_overlay_delete_handler))
        .route("/user/hexagons/bulk", post(user_overlay_bulk_set_handler))
        .route("/user/hexagons", get(user_overlay_list_handler))
        .route("/user/clear", delete(user_overlay_clear_handler))
        .route("/batch/analyze", post(batch_analyze_handler))
        .layer(DefaultBodyLimit::max(MAX_BODY_BYTES))
        .layer(middleware::from_fn_with_state(state.clone(), cors_layer))
        .layer(middleware::from_fn_with_state(state.clone(), auth_layer))
        .with_state(state.clone());

    let fixed_port: u16 = args.iter()
        .find_map(|a| a.strip_prefix("--port=").and_then(|v| v.parse().ok()))
        .unwrap_or(if is_server_mode { 7557 } else { 0 });
    let listener = TcpListener::bind(std::net::SocketAddr::new(bind_addr, fixed_port)).await?;
    let addr: SocketAddr = listener.local_addr()?;

    // ── IPC protocol: stdout signals parsed by tauri-shell/src/hooks/useEngine.ts ──
    // These are NOT debug output — they are the inter-process communication channel.
    println!("ENGINE_PORT={}", addr.port());
    println!("ENGINE_TOKEN={}", auth_token);
    println!("ENGINE_BIND={}", bind_addr);
    println!("ENGINE_SERVER_UP");
    std::io::stdout().flush().ok();

    tracing::info!("Engine server up on {} (plan: {}), loading VDB in background...", addr, plan_label);

    // Spawn HTTP server
    tokio::spawn(async move {
        if let Err(e) = axum::serve(listener, app)
            .with_graceful_shutdown(shutdown_signal())
            .await
        {
            tracing::error!("Server error during shutdown: {}", e);
        }
    });

    // Load VDB in blocking thread (CPU-bound, 517MB)
    let state2 = state.clone();
    let hexdb_path2 = hexdb_path.clone();
    tokio::task::spawn_blocking(move || {
        tracing::info!("Loading encrypted hex database: {}", hexdb_path2);
        match search::HexIndex::from_edbh_with_progress(&hexdb_path2, |pct| {
            state2.load_progress.store(pct, Ordering::Relaxed);
            println!("ENGINE_LOADING={}", pct);
            let _ = std::io::stdout().flush();
        }) {
            Ok(idx) => {
                tracing::info!(
                    "Loaded {} hexagons ({} countries, {} cities)",
                    idx.stats.total_hexagons, idx.stats.total_countries, idx.stats.total_cities,
                );
                state2.hex_index.set(idx).ok();
                state2.load_progress.store(100, Ordering::Relaxed);
                println!("ENGINE_READY");
                let _ = std::io::stdout().flush();
            }
            Err(e) => {
                tracing::error!("Failed to load hex database: {}", e);
                println!("ENGINE_ERROR={}", e);
                let _ = std::io::stdout().flush();
            }
        }
    });

    // Keep main alive until process is killed
    std::future::pending::<()>().await;
    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────────
// Shutdown
// ─────────────────────────────────────────────────────────────────────────────

async fn shutdown_signal() {
    let ctrl_c = async {
        if let Err(e) = tokio::signal::ctrl_c().await {
            tracing::warn!("Failed to install Ctrl+C handler: {}, using fallback", e);
            // Fallback: just wait forever (other signals or timeout will handle shutdown)
            std::future::pending::<()>().await;
        }
    };

    #[cfg(unix)]
    let terminate = async {
        match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
            Ok(mut sig) => { sig.recv().await; }
            Err(e) => {
                tracing::warn!("Failed to install SIGTERM handler: {}", e);
                std::future::pending::<()>().await;
            }
        }
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {},
        _ = terminate => {},
    }

    tracing::info!("Shutdown signal received");
}

// ─────────────────────────────────────────────────────────────────────────────
// Token generation (CSPRNG)
// ─────────────────────────────────────────────────────────────────────────────

/// Generate a cryptographically secure random auth token using OsRng.
fn generate_token() -> String {
    use rand::RngCore;
    let mut bytes = [0u8; 32];
    rand::rngs::OsRng.fill_bytes(&mut bytes);
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

// ─────────────────────────────────────────────────────────────────────────────
// Auth middleware (constant-time comparison)
// ─────────────────────────────────────────────────────────────────────────────

/// CORS middleware — restricts engine API to trusted Tauri origins in desktop mode.
/// In server mode (--bind=0.0.0.0), CORS is open: any origin is allowed.
/// The API key is the sole security layer in server mode.
async fn cors_layer(
    State(state): State<Arc<AppState>>,
    req_headers: HeaderMap,
    request: axum::extract::Request,
    next: Next,
) -> axum::response::Response {
    let origin = req_headers
        .get(header::ORIGIN)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");

    // Server mode: accept any origin — API key handles auth
    // Desktop mode: only trusted Tauri WebView origins
    let trusted = state.server_mode || matches!(
        origin,
        "tauri://localhost" | "https://tauri.localhost" |
        "http://localhost:5173" | "http://127.0.0.1:5173"
    ) || origin.is_empty();

    let mut response = next.run(request).await;

    if trusted {
        let hdrs = response.headers_mut();
        let origin_value = if origin.is_empty() {
            HeaderValue::from_static("tauri://localhost")
        } else {
            HeaderValue::from_str(origin).unwrap_or(HeaderValue::from_static("tauri://localhost"))
        };
        hdrs.insert("Access-Control-Allow-Origin", origin_value);
        hdrs.insert("Access-Control-Allow-Methods",
            HeaderValue::from_static("GET, POST, PUT, DELETE, OPTIONS"));
        hdrs.insert("Access-Control-Allow-Headers",
            HeaderValue::from_static("Authorization, Content-Type"));
        hdrs.insert("Access-Control-Max-Age", HeaderValue::from_static("86400"));
    }
    response
}

async fn auth_layer(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    request: axum::extract::Request,
    next: Next,
) -> Result<axum::response::Response, StatusCode> {
    // ── Global rate limiter (packed u64: high 32 = unix second, low 32 = count) ──
    let now_sec = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    loop {
        let packed = state.rate_bucket.load(Ordering::Relaxed);
        let bucket_sec = (packed >> 32) as u32;
        let count = (packed & 0xFFFF_FFFF) as u32;

        let (new_count, new_sec) = if bucket_sec == now_sec as u32 {
            (count + 1, bucket_sec)
        } else {
            (1u32, now_sec as u32)
        };

        if new_count > MAX_REQ_PER_SECOND {
            tracing::warn!("Rate limit exceeded ({} req/s)", MAX_REQ_PER_SECOND);
            return Err(StatusCode::TOO_MANY_REQUESTS);
        }

        let new_packed = ((new_sec as u64) << 32) | (new_count as u64);
        if state.rate_bucket.compare_exchange(packed, new_packed, Ordering::AcqRel, Ordering::Relaxed).is_ok() {
            break;
        }
        // CAS failed — retry (extremely rare, means concurrent request updated the counter)
    }

    // ── Health endpoints are unauthenticated (intentional — UI polling) ────────
    if request.uri().path() == "/health" || request.uri().path() == "/engine/health" {
        return Ok(next.run(request).await);
    }

    let token = headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "));

    match token {
        Some(t) if constant_time_eq(t.as_bytes(), state.auth_token.as_bytes()) => {
            Ok(next.run(request).await)
        }
        // Persistent API key — accepted alongside the ephemeral session token so
        // external programs don't need to re-read the session file on each restart.
        Some(t) if state.api_key
            .as_deref()
            .map(|k| constant_time_eq(t.as_bytes(), k.as_bytes()))
            .unwrap_or(false) =>
        {
            Ok(next.run(request).await)
        }
        _ => {
            tracing::warn!(
                "Unauthorized request to {}",
                request.uri().path(),
            );
            Err(StatusCode::UNAUTHORIZED)
        }
    }
}

/// Constant-time byte comparison to prevent timing attacks.
#[inline]
fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (&x, &y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

// ─────────────────────────────────────────────────────────────────────────────
// Handlers
// ─────────────────────────────────────────────────────────────────────────────

/// GET /health — public readiness probe.
async fn health_handler(State(state): State<Arc<AppState>>) -> Json<serde_json::Value> {
    let is_loaded = state.hex_index.get().is_some();
    let pct = state.load_progress.load(Ordering::Relaxed);
    Json(serde_json::json!({
        "status": if is_loaded { "ok" } else { "loading" },
        "progress": pct,
        "engine": "eodi-engine",
        "version": env!("CARGO_PKG_VERSION"),
    }))
}

/// GET /engine/health — compatibility endpoint for browser standalone mode.
/// Returns the format that the Tauri frontend's useEngine.ts expects.
async fn engine_health_handler(State(state): State<Arc<AppState>>) -> Json<serde_json::Value> {
    let is_loaded = state.hex_index.get().is_some();
    let pct = state.load_progress.load(Ordering::Relaxed);
    Json(serde_json::json!({
        "engine": "ok",
        "mode": "encrypted_engine",
        "status": if is_loaded { "ok" } else { "loading" },
        "progress": pct,
    }))
}

/// GET /stats — pre-computed database statistics (O(1), no iteration).
async fn stats_handler(
    State(state): State<Arc<AppState>>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let idx = match state.idx() {
        Some(i) => i,
        None => return Err(StatusCode::SERVICE_UNAVAILABLE),
    };
    let s = &idx.stats;
    Ok(Json(serde_json::json!({
        "total_hexagons": s.total_hexagons,
        "total_countries": s.total_countries,
        "total_cities": s.total_cities,
        "with_vectors": s.total_hexagons,
        "schema_version": s.schema_version,
        "spec_version": s.spec_version,
        "built_at": s.built_at,
        "sigma_squared": s.sigma_squared,
    })))
}

/// GET /countries — list all unique country codes in the database (sorted, O(1)).
async fn countries_handler(
    State(state): State<Arc<AppState>>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let idx = match state.idx() {
        Some(i) => i,
        None => return Err(StatusCode::SERVICE_UNAVAILABLE),
    };
    Ok(Json(serde_json::json!({
        "countries": idx.list_countries(),
    })))
}

/// GET /cities?country=XX — list all cities for a given country code.
#[derive(Deserialize)]
struct CitiesParams {
    country: String,
}

async fn cities_handler(
    State(state): State<Arc<AppState>>,
    Query(params): Query<CitiesParams>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let idx = match state.idx() {
        Some(i) => i,
        None => return Err(StatusCode::SERVICE_UNAVAILABLE),
    };
    Ok(Json(serde_json::json!({
        "country": params.country.to_uppercase(),
        "cities": idx.list_cities(&params.country),
    })))
}

// ── Search ───────────────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct HexSearchParams {
    q: String,
    #[serde(default = "default_limit")]
    limit: usize,
    country: Option<String>,
    city: Option<String>,
}

fn default_limit() -> usize {
    20
}

/// GET /hex/search?q=...&limit=...&country=...&city=...
async fn hex_search_handler(
    State(state): State<Arc<AppState>>,
    Query(params): Query<HexSearchParams>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    if params.q.len() > MAX_QUERY_LEN || params.q.trim().len() < 2 {
        return Err(StatusCode::BAD_REQUEST);
    }

    let idx = match state.idx() {
        Some(i) => i,
        None => return Err(StatusCode::SERVICE_UNAVAILABLE),
    };

    let limit = params.limit.clamp(1, MAX_RESULT_LIMIT);
    let hexagons: Vec<serde_json::Value> = idx
        .search(
            &params.q,
            limit,
            params.country.as_deref(),
            params.city.as_deref(),
        )
        .iter()
        .map(|h| hex_to_json(h, &state.user_overlay))
        .collect();

    let found = hexagons.len();
    Ok(Json(serde_json::json!({
        "hexagons": hexagons,
        "meta": {
            "count": found,
            "empty": found == 0,
            "reason": if found == 0 { "no_data_in_region" } else { "ok" },
        }
    })))
}

// ── Match ────────────────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct HexMatchParams {
    h3_index: String,
    #[serde(default = "default_hex_k")]
    top_k: usize,
    country: Option<String>,
    city: Option<String>,
}

fn default_hex_k() -> usize {
    20
}

/// GET /hex/match?h3_index=...&top_k=...
///
/// Free tier — similarity matching on existing data is available to all users.
async fn hex_match_handler(
    State(state): State<Arc<AppState>>,
    Query(params): Query<HexMatchParams>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let idx = match state.idx() {
        Some(i) => i,
        None => return Err(StatusCode::SERVICE_UNAVAILABLE),
    };
    let h3_index: u64 = params.h3_index.parse().map_err(|_| StatusCode::BAD_REQUEST)?;
    let top_k = params.top_k.clamp(1, MAX_RESULT_LIMIT);

    let query_hex = idx
        .get_hex(h3_index)
        .ok_or(StatusCode::NOT_FOUND)?;

    let query_user = state.user_overlay.get(query_hex.h3_index);
    let mut query_vector = query_hex.vector;
    math::rebuild_vibe_dims(&mut query_vector, &query_hex.poi_counts, query_user.as_ref());
    let overlay_map = state.user_overlay.list();

    let matches = idx.find_similar_with_overlay(
        &query_vector,
        top_k,
        Some(h3_index),
        params.country.as_deref(),
        params.city.as_deref(),
        Some(&overlay_map),
    );

    let results: Vec<serde_json::Value> = matches
        .iter()
        .map(|m| {
            let hex = idx.hex_at(m.hex_idx);
            let user_counts = state.user_overlay.get(hex.h3_index);
            serde_json::json!({
                "h3_index": hex.h3_index.to_string(),
                "admin_name": hex.admin_name,
                "admin_level": hex.admin_level,
                "lat": hex.lat,
                "lon": hex.lon,
                "parent_city_id": hex.parent_city_id.to_string(),
                "parent_city_name": hex.parent_city_name,
                "country": hex.country_code,
                "similarity": m.similarity,
                "distance": m.distance,
                "match_reason": "Hex vibe similarity match",
                "has_user_data": user_counts.is_some(),
                "radar": math::compute_vibe_from_poi(&hex.poi_counts, user_counts.as_ref(), &hex.vector),
            })
        })
        .collect();

    let returned = results.len();
    // truncated = results came back but fewer than requested (not zero = "no data")
    let truncated = returned > 0 && returned < top_k;
    // sparse_region = we got results but far fewer than half the requested count
    let sparse_region = returned > 0 && top_k >= 2 && returned < top_k / 2;
    Ok(Json(serde_json::json!({
        "matches": results,
        "query_hex": {
            "h3_index": query_hex.h3_index.to_string(),
            "admin_name": query_hex.admin_name,
            "parent_city_name": query_hex.parent_city_name,
            "country": query_hex.country_code,
            "radar": math::compute_vibe_from_poi(&query_hex.poi_counts, query_user.as_ref(), &query_hex.vector),
        },
        "sigma_squared": idx.db.sigma_squared,
        "meta": {
            "requested": top_k,
            "returned": returned,
            "truncated": truncated,
            "sparse_region": sparse_region,
        },
    })))
}

#[derive(Deserialize)]
struct UserOverlayBulkItem {
    h3_index: String,
    poi_counts: [u32; 7],
}

#[derive(Deserialize)]
struct UserOverlayBulkBody {
    items: Vec<UserOverlayBulkItem>,
}

/// POST /user/hexagons/bulk — set multiple user overlays in one request.
async fn user_overlay_bulk_set_handler(
    State(state): State<Arc<AppState>>,
    axum::extract::Json(body): axum::extract::Json<UserOverlayBulkBody>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    state.plan.require_pro()?; // Solo Biz+ only — bulk POI import is a paid feature
    if body.items.is_empty() {
        return Err(StatusCode::BAD_REQUEST);
    }

    let mut applied = 0usize;
    let mut failed: Vec<serde_json::Value> = Vec::new();

    for item in body.items.iter() {
        let h3_index: u64 = match item.h3_index.parse() {
            Ok(v) => v,
            Err(_) => {
                failed.push(serde_json::json!({
                    "h3_index": item.h3_index,
                    "reason": "invalid_h3",
                }));
                continue;
            }
        };

        if let Err(e) = state.user_overlay.set(h3_index, item.poi_counts) {
            tracing::error!("Failed to persist bulk overlay for {}: {}", h3_index, e);
            failed.push(serde_json::json!({
                "h3_index": item.h3_index,
                "reason": "persist_failed",
            }));
            continue;
        }

        applied += 1;
    }

    Ok(Json(serde_json::json!({
        "status": if failed.is_empty() { "ok" } else { "partial" },
        "applied": applied,
        "failed": failed,
    })))
}

// ── Detail ───────────────────────────────────────────────────────────────────

/// GET /hex/:h3 — single hexagon detail.
async fn hex_detail_handler(
    State(state): State<Arc<AppState>>,
    Path(h3): Path<String>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let idx = match state.idx() {
        Some(i) => i,
        None => return Err(StatusCode::SERVICE_UNAVAILABLE),
    };
    let h3_index: u64 = h3.parse().map_err(|_| StatusCode::BAD_REQUEST)?;
    let hex = idx
        .get_hex(h3_index)
        .ok_or(StatusCode::NOT_FOUND)?;

    let user_counts = state.user_overlay.get(hex.h3_index);
    Ok(Json(serde_json::json!({
        "h3_index": hex.h3_index.to_string(),
        "lat": hex.lat,
        "lon": hex.lon,
        "admin_name": hex.admin_name,
        "admin_level": hex.admin_level,
        "parent_city_id": hex.parent_city_id.to_string(),
        "parent_city_name": hex.parent_city_name,
        "city": hex.parent_city_name,
        "country": hex.country_code,
        "vector": hex.vector,
        "poi_counts": hex.poi_counts,
        "has_user_data": user_counts.is_some(),
        "user_poi_counts": user_counts,
        "radar": math::compute_vibe_from_poi(&hex.poi_counts, user_counts.as_ref(), &hex.vector),
    })))
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/// Serialize a HexVector to the standard JSON response shape.
/// Merges user overlay data if present for dynamic 6-axis vibe.
fn hex_to_json(h: &models::HexVector, user_overlay: &overlay::UserOverlayStore) -> serde_json::Value {
    let user_counts = user_overlay.get(h.h3_index);
    serde_json::json!({
        "h3_index": h.h3_index.to_string(),
        "admin_name": h.admin_name,
        "admin_level": h.admin_level,
        "country": h.country_code,
        "city": h.parent_city_name,
        "lat": h.lat,
        "lon": h.lon,
        "poi_counts": h.poi_counts,
        "has_user_data": user_counts.is_some(),
        "radar": math::compute_vibe_from_poi(&h.poi_counts, user_counts.as_ref(), &h.vector),
        // Commercial signal dimensions — normalized 0.0–1.0.
        // Exposed so the frontend Market Signals panel can show SMB-relevant insights
        // without requiring additional data sources.
        "signals": {
            "poi_density":         h.vector[6],   // dim 6: POI density (activity level)
            "category_diversity":  h.vector[7],   // dim 7: Shannon entropy of POI categories (competition)
            "temporal_entropy":    h.vector[9],   // dim 9: 24h activity pattern (peak vs all-day)
            "flow_ratio":          h.vector[10],  // dim 10: flow/POI ratio (demand vs supply)
            "pop_density":         h.vector[11],  // dim 11: population density (customer pool)
            "transit_score":       h.vector[12],  // dim 12: transit accessibility
        },
    })
}

// ── Viewport ─────────────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct HexViewportParams {
    north: f32,
    south: f32,
    east: f32,
    west: f32,
    #[serde(default = "default_limit")]
    limit: usize,
}

/// GET /hex/viewport?north=&south=&east=&west=&limit=
/// Returns hexagons within the specified bounding box.
async fn hex_viewport_handler(
    State(state): State<Arc<AppState>>,
    Query(params): Query<HexViewportParams>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let idx = match state.idx() {
        Some(i) => i,
        None => return Err(StatusCode::SERVICE_UNAVAILABLE),
    };
    let limit = params.limit.clamp(1, MAX_RESULT_LIMIT);
    let hexagons: Vec<serde_json::Value> = idx
        .viewport(params.north, params.south, params.east, params.west, limit)
        .iter()
        .map(|h| hex_to_json(h, &state.user_overlay))
        .collect();

    Ok(Json(serde_json::json!({
        "hexagons": hexagons,
        "total_in_view": hexagons.len(),
    })))
}

// ── Discover ─────────────────────────────────────────────────────────────────

fn default_weight() -> f32 {
    1.0
}

/// 6-axis Urban Vibe preference weights (all default to 1.0 = equal weight).
///
/// Axis mapping:
/// - `w_active`  → vitality   (dim 0)
/// - `w_classic` → culture    (dim 1)
/// - `w_quiet`   → relief     (dim 2)
/// - `w_trendy`  → rhythm     (dim 3)
/// - `w_nature`  → lifestyle  (dim 4)
/// - `w_urban`   → commercial (dim 5)
#[derive(Deserialize, Clone, Copy)]
struct VibeWeightParams {
    #[serde(default = "default_weight")]
    w_active: f32,
    #[serde(default = "default_weight")]
    w_classic: f32,
    #[serde(default = "default_weight")]
    w_quiet: f32,
    #[serde(default = "default_weight")]
    w_trendy: f32,
    #[serde(default = "default_weight")]
    w_nature: f32,
    #[serde(default = "default_weight")]
    w_urban: f32,
}

#[derive(Deserialize)]
struct HexDiscoverParams {
    #[serde(flatten)]
    weights: VibeWeightParams,
    #[serde(default = "default_limit")]
    limit: usize,
    country: Option<String>,
    city: Option<String>,
}

/// GET /hex/discover?w_active=0.8&...&limit=50
///
/// Free tier — preference-based discovery on existing data is available to all users.
async fn hex_discover_handler(
    State(state): State<Arc<AppState>>,
    Query(params): Query<HexDiscoverParams>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let idx = match state.idx() {
        Some(i) => i,
        None => return Err(StatusCode::SERVICE_UNAVAILABLE),
    };
    let limit = params.limit.clamp(1, MAX_RESULT_LIMIT);
    let w = params.weights;
    let weights = [w.w_active, w.w_classic, w.w_quiet, w.w_trendy, w.w_nature, w.w_urban];

    let overlay_map = state.user_overlay.list();
    let scored = idx.discover_by_weights(
        &weights,
        limit,
        params.country.as_deref(),
        params.city.as_deref(),
        Some(&overlay_map),
    );

    let hexagons: Vec<serde_json::Value> = scored
        .iter()
        .map(|(suit, hex_pos)| {
            let hex = idx.hex_at(*hex_pos);
            let user_counts = state.user_overlay.get(hex.h3_index);
            let radar = math::compute_vibe_from_poi(&hex.poi_counts, user_counts.as_ref(), &hex.vector);
            serde_json::json!({
                "h3_index": hex.h3_index.to_string(),
                "admin_name": hex.admin_name,
                "admin_level": hex.admin_level,
                "lat": hex.lat,
                "lon": hex.lon,
                "parent_city_name": hex.parent_city_name,
                "country": hex.country_code,
                "suitability": suit,
                "has_user_data": user_counts.is_some(),
                "radar": radar,
            })
        })
        .collect();

    Ok(Json(serde_json::json!({
        "hexagons": hexagons,
        "count": hexagons.len(),
    })))
}

// ── Nearest ──────────────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct HexNearestParams {
    lat: f32,
    lon: f32,
    #[serde(default = "default_nearest_k")]
    k: usize,
}

fn default_nearest_k() -> usize { 1 }

/// GET /hex/nearest?lat=&lon=&k=
/// Returns the k nearest hexagons to a given lat/lon point.
async fn hex_nearest_handler(
    State(state): State<Arc<AppState>>,
    Query(params): Query<HexNearestParams>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let idx = match state.idx() {
        Some(i) => i,
        None => return Err(StatusCode::SERVICE_UNAVAILABLE),
    };
    let k = params.k.clamp(1, 50);
    let hexagons: Vec<serde_json::Value> = idx
        .nearest_k(params.lat, params.lon, k)
        .iter()
        .map(|h| hex_to_json(h, &state.user_overlay))
        .collect();

    Ok(Json(serde_json::json!({
        "hexagons": hexagons,
        "count": hexagons.len(),
    })))
}

// ─────────────────────────────────────────────────────────────────────────────
// User overlay endpoints — separate from immutable hex VDB
// ─────────────────────────────────────────────────────────────────────────────

/// PUT /user/hex/:h3 — set user POI counts for a hexagon.
///
/// Body: `{"poi_counts": [vitality, culture, relief, rhythm, lifestyle, commercial, total]}`
///
/// The original hex VDB is NEVER modified. User data is stored separately
/// and merged on-the-fly when computing 6-axis vibe.
async fn user_overlay_set_handler(
    State(state): State<Arc<AppState>>,
    Path(h3): Path<String>,
    axum::extract::Json(body): axum::extract::Json<serde_json::Value>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    state.plan.require_pro()?; // Solo Biz+ only — custom POI overlay is a paid feature
    let h3_index: u64 = h3.parse().map_err(|_| StatusCode::BAD_REQUEST)?;

    let counts: [u32; 7] = body
        .get("poi_counts")
        .and_then(|v| serde_json::from_value(v.clone()).ok())
        .ok_or(StatusCode::BAD_REQUEST)?;

    state
        .user_overlay
        .set(h3_index, counts)
        .map_err(|e| {
            tracing::error!("Failed to persist user overlay: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    // Return the merged radar for immediate feedback
    let base = state.idx().and_then(|i| i.get_hex(h3_index));
    let base_counts = base.map(|h| h.poi_counts).unwrap_or([0; 7]);
    let base_vector = base.map(|h| h.vector).unwrap_or([0.0; 13]);
    let radar = math::compute_vibe_from_poi(&base_counts, Some(&counts), &base_vector);

    Ok(Json(serde_json::json!({
        "status": "ok",
        "h3_index": h3_index.to_string(),
        "user_poi_counts": counts,
        "base_poi_counts": base_counts,
        "merged_radar": radar,
    })))
}

/// GET /user/hex/:h3 — get user overlay for a specific hexagon.
async fn user_overlay_get_handler(
    State(state): State<Arc<AppState>>,
    Path(h3): Path<String>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let h3_index: u64 = h3.parse().map_err(|_| StatusCode::BAD_REQUEST)?;

    match state.user_overlay.get(h3_index) {
        Some(counts) => {
            let base = state.idx().and_then(|i| i.get_hex(h3_index));
            let base_counts = base.map(|h| h.poi_counts).unwrap_or([0; 7]);
            let base_vector = base.map(|h| h.vector).unwrap_or([0.0; 13]);
            Ok(Json(serde_json::json!({
                "h3_index": h3_index.to_string(),
                "user_poi_counts": counts,
                "base_poi_counts": base_counts,
                "merged_radar": math::compute_vibe_from_poi(&base_counts, Some(&counts), &base_vector),
            })))
        }
        None => Err(StatusCode::NOT_FOUND),
    }
}

/// DELETE /user/hex/:h3 — remove user overlay for a hexagon.
async fn user_overlay_delete_handler(
    State(state): State<Arc<AppState>>,
    Path(h3): Path<String>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    state.plan.require_pro()?; // Solo Biz+ only
    let h3_index: u64 = h3.parse().map_err(|_| StatusCode::BAD_REQUEST)?;

    let removed = state
        .user_overlay
        .remove(h3_index)
        .map_err(|e| {
            tracing::error!("Failed to persist user overlay removal: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    if removed {
        Ok(Json(serde_json::json!({
            "status": "removed",
            "h3_index": h3_index.to_string(),
        })))
    } else {
        Err(StatusCode::NOT_FOUND)
    }
}

/// GET /user/hexagons — list all user overlay entries.
async fn user_overlay_list_handler(
    State(state): State<Arc<AppState>>,
) -> Json<serde_json::Value> {
    let overlays = state.user_overlay.list();
    let entries: Vec<serde_json::Value> = overlays
        .iter()
        .map(|(h3, counts)| {
            let base = state.idx().and_then(|i| i.get_hex(*h3));
            let base_counts = base.map(|h| h.poi_counts).unwrap_or([0; 7]);
            let base_vector = base.map(|h| h.vector).unwrap_or([0.0; 13]);
            serde_json::json!({
                "h3_index": h3.to_string(),
                "user_poi_counts": counts,
                "base_poi_counts": base_counts,
                "merged_radar": math::compute_vibe_from_poi(&base_counts, Some(counts), &base_vector),
            })
        })
        .collect();

    Json(serde_json::json!({
        "count": entries.len(),
        "overlays": entries,
    }))
}

/// DELETE /user/clear — remove ALL user overlays.
async fn user_overlay_clear_handler(
    State(state): State<Arc<AppState>>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let before = state.user_overlay.count();
    state
        .user_overlay
        .clear()
        .map_err(|e| {
            tracing::error!("Failed to clear user overlays: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    Ok(Json(serde_json::json!({
        "status": "cleared",
        "removed_count": before,
    })))
}

// ── Batch Analysis ────────────────────────────────────────────────────────────

const MAX_BATCH_SIZE: usize = 100;

#[derive(Deserialize)]
struct BatchAnalyzeBody {
    /// List of H3 index strings (u64 as decimal string). Max 100.
    h3_indices: Vec<String>,
    /// Include raw 15D vector in response (default false).
    #[serde(default)]
    include_vector: bool,
}

/// POST /batch/analyze — analyze multiple hexagons in a single request.
///
/// **Pro only** — returns 402 Payment Required for Free tier.
/// Returns radar chart + metadata for each hex. Unknown indices are included
/// with `"error": "not_found"` so callers know which ones failed.
async fn batch_analyze_handler(
    State(state): State<Arc<AppState>>,
    axum::extract::Json(body): axum::extract::Json<BatchAnalyzeBody>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    state.plan.require_pro()?;

    if body.h3_indices.is_empty() || body.h3_indices.len() > MAX_BATCH_SIZE {
        return Err(StatusCode::BAD_REQUEST);
    }

    let idx = match state.idx() {
        Some(i) => i,
        None => return Err(StatusCode::SERVICE_UNAVAILABLE),
    };

    let results: Vec<serde_json::Value> = body
        .h3_indices
        .iter()
        .map(|h3_str| {
            let h3: u64 = match h3_str.trim().parse() {
                Ok(v) => v,
                Err(_) => {
                    return serde_json::json!({
                        "h3_index": h3_str,
                        "error": "invalid_h3",
                    })
                }
            };

            let hex = match idx.get_hex(h3) {
                Some(h) => h,
                None => {
                    return serde_json::json!({
                        "h3_index": h3_str,
                        "error": "not_found",
                    })
                }
            };

            let user_counts = state.user_overlay.get(hex.h3_index);
            let radar = math::compute_vibe_from_poi(&hex.poi_counts, user_counts.as_ref(), &hex.vector);

            let mut entry = serde_json::json!({
                "h3_index": hex.h3_index.to_string(),
                "admin_name": hex.admin_name,
                "admin_level": hex.admin_level,
                "lat": hex.lat,
                "lon": hex.lon,
                "country": hex.country_code,
                "city": hex.parent_city_name,
                "has_user_data": user_counts.is_some(),
                "radar": radar,
            });

            if body.include_vector {
                entry["vector"] = serde_json::json!(hex.vector);
            }

            entry
        })
        .collect();

    Ok(Json(serde_json::json!({
        "count": results.len(),
        "results": results,
    })))
}