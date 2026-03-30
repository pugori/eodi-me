use reqwest::Client;
use std::sync::Arc;
use std::time::Duration;
use tracing::{debug, error, warn};

use crate::metrics::CollectorMetrics;
use crate::ratelimit::DomainRateLimiter;

const MAX_RETRIES: u32 = 5;
const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);

/// Production-grade HTTP collector.
///
/// - Domain-level rate limiting via slot reservation
/// - Exponential back-off on 429 / 5xx
/// - Connection pool reuse across all concurrent requests
/// - All methods take `&self` → suitable for `Arc<Collector>`, no `Mutex` needed
pub struct Collector {
    client: Client,
    rate_limiter: Arc<DomainRateLimiter>,
    metrics: Arc<CollectorMetrics>,
}

impl Collector {
    pub fn new(user_agent: &str, default_delay_secs: f64, max_delay_secs: f64) -> Self {
        let client = Client::builder()
            .user_agent(user_agent)
            .timeout(REQUEST_TIMEOUT)
            .connect_timeout(CONNECT_TIMEOUT)
            .tcp_keepalive(Duration::from_secs(30))
            .pool_max_idle_per_host(64)
            .pool_idle_timeout(Duration::from_secs(90))
            .gzip(true)
            .brotli(true)
            .redirect(reqwest::redirect::Policy::limited(5))
            .build()
            .expect("Failed to build HTTP client");

        let rate_limiter = Arc::new(DomainRateLimiter::new(default_delay_secs, max_delay_secs));

        // Overpass API: 2 s between requests per domain slot
        rate_limiter.set_delay("https://overpass-api.de/api/interpreter", 2.0);
        // NASA POWER: generous, no stated rate limit
        rate_limiter.set_delay("https://power.larc.nasa.gov", 0.2);
        // REST Countries: light usage
        rate_limiter.set_delay("https://restcountries.com", 0.1);

        Self {
            client,
            rate_limiter,
            metrics: Arc::new(CollectorMetrics::new()),
        }
    }

    /// Fetch `url`, returning raw bytes.
    ///
    /// Retry schedule (exponential back-off):
    ///   attempt 1 → immediate
    ///   attempt 2 → 500 ms
    ///   attempt 3 → 1 s
    ///   attempt 4 → 2 s
    ///   attempt 5 → 4 s
    ///
    /// 429 always retries (after doubling the domain delay).
    /// 4xx (non-429) fail immediately — retrying won't help.
    /// DNS / TLS failures break immediately.
    pub async fn fetch(&self, url: &str) -> anyhow::Result<Vec<u8>> {
        let mut last_err = anyhow::anyhow!("no attempts made");

        for attempt in 0..MAX_RETRIES {
            if attempt > 0 {
                let delay_ms = 500u64 * 2u64.pow(attempt - 1); // 500, 1000, 2000, 4000 ms
                debug!("Retry {}/{} for {} (wait {}ms)", attempt, MAX_RETRIES - 1, url, delay_ms);
                tokio::time::sleep(Duration::from_millis(delay_ms)).await;
            }

            self.rate_limiter.await_slot(url).await;

            match self.client.get(url).send().await {
                Ok(resp) => {
                    let status = resp.status();

                    if status == reqwest::StatusCode::TOO_MANY_REQUESTS {
                        warn!("429 Too Many Requests: {} (attempt {})", url, attempt + 1);
                        self.rate_limiter.back_off(url);
                        last_err = anyhow::anyhow!("HTTP 429");
                        continue;
                    }

                    if status.is_server_error() {
                        warn!("HTTP {}: {} (attempt {})", status, url, attempt + 1);
                        last_err = anyhow::anyhow!("HTTP {}", status);
                        continue;
                    }

                    if status.is_client_error() {
                        // 404, 400 etc. — retrying won't help
                        self.metrics.record_failure();
                        return Err(anyhow::anyhow!("HTTP {} for {}", status, url));
                    }

                    match resp.bytes().await {
                        Ok(bytes) => {
                            self.metrics.record_success(bytes.len() as u64);
                            return Ok(bytes.to_vec());
                        }
                        Err(e) => {
                            last_err = anyhow::anyhow!("body read: {}", e);
                            continue;
                        }
                    }
                }
                Err(e) => {
                    let is_transient = e.is_timeout()
                        || e.is_connect()
                        || {
                            let s = e.to_string();
                            s.contains("connection reset")
                                || s.contains("connection closed")
                                || s.contains("unexpected EOF")
                                || s.contains("os error 10054") // Windows ECONNRESET
                                || s.contains("os error 104")   // Linux ECONNRESET
                        };

                    last_err = e.into();
                    if is_transient {
                        warn!("Transient error (attempt {}): {}", attempt + 1, last_err);
                        continue;
                    }
                    break; // DNS / TLS — no point retrying
                }
            }
        }

        self.metrics.record_failure();
        error!("{} retries exhausted for {}: {}", MAX_RETRIES, url, last_err);
        Err(anyhow::anyhow!("fetch failed ({} retries) for {}: {}", MAX_RETRIES, url, last_err))
    }

    /// Fetch and deserialise JSON.
    #[allow(dead_code)]
    pub async fn fetch_json(&self, url: &str) -> anyhow::Result<serde_json::Value> {
        let bytes = self.fetch(url).await?;
        serde_json::from_slice(&bytes)
            .map_err(|e| anyhow::anyhow!("JSON parse error for {}: {}", url, e))
    }

    /// Current HTTP metrics snapshot.
    #[allow(dead_code)]
    pub fn metrics_snapshot(&self) -> crate::metrics::MetricsSnapshot {
        self.metrics.snapshot()
    }

    /// Shared rate-limiter handle (allows callers to tweak delays at runtime).
    #[allow(dead_code)]
    pub fn rate_limiter(&self) -> &Arc<DomainRateLimiter> {
        &self.rate_limiter
    }
}
