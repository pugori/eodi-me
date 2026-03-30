use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::time::Instant;

/// Thread-safe performance metrics tracker
#[derive(Debug)]
pub struct CollectorMetrics {
    total_requests: AtomicUsize,
    successful_requests: AtomicUsize,
    failed_requests: AtomicUsize,
    #[allow(dead_code)]
    cached_requests: AtomicUsize,
    blocked_by_robots: AtomicUsize,
    total_bytes_downloaded: AtomicU64,
    #[allow(dead_code)]
    start_time: Instant,
}

#[derive(Debug, serde::Serialize)]
#[allow(dead_code)]
pub struct MetricsSnapshot {
    pub total_requests: usize,
    pub successful_requests: usize,
    pub failed_requests: usize,
    pub cached_requests: usize,
    pub blocked_by_robots: usize,
    pub success_rate: f64,
    pub total_bytes_downloaded: u64,
    pub avg_throughput_mbps: f64,
    pub elapsed_seconds: f64,
    pub requests_per_second: f64,
}

impl CollectorMetrics {
    pub fn new() -> Self {
        Self {
            total_requests: AtomicUsize::new(0),
            successful_requests: AtomicUsize::new(0),
            failed_requests: AtomicUsize::new(0),
            cached_requests: AtomicUsize::new(0),
            blocked_by_robots: AtomicUsize::new(0),
            total_bytes_downloaded: AtomicU64::new(0),
            start_time: Instant::now(),
        }
    }

    pub fn record_success(&self, bytes_downloaded: u64) {
        self.successful_requests.fetch_add(1, Ordering::Relaxed);
        self.total_requests.fetch_add(1, Ordering::Relaxed);
        self.total_bytes_downloaded
            .fetch_add(bytes_downloaded, Ordering::Relaxed);
    }

    pub fn record_failure(&self) {
        self.failed_requests.fetch_add(1, Ordering::Relaxed);
        self.total_requests.fetch_add(1, Ordering::Relaxed);
    }

    #[allow(dead_code)]
    pub fn record_cached(&self) {
        self.cached_requests.fetch_add(1, Ordering::Relaxed);
        self.total_requests.fetch_add(1, Ordering::Relaxed);
    }

    #[allow(dead_code)]
    pub fn record_blocked(&self) {
        self.blocked_by_robots.fetch_add(1, Ordering::Relaxed);
        self.total_requests.fetch_add(1, Ordering::Relaxed);
    }

    #[allow(dead_code)]
    pub fn snapshot(&self) -> MetricsSnapshot {
        let total = self.total_requests.load(Ordering::Relaxed);
        let success = self.successful_requests.load(Ordering::Relaxed);
        let failed = self.failed_requests.load(Ordering::Relaxed);
        let cached = self.cached_requests.load(Ordering::Relaxed);
        let blocked = self.blocked_by_robots.load(Ordering::Relaxed);
        let bytes = self.total_bytes_downloaded.load(Ordering::Relaxed);
        let elapsed = self.start_time.elapsed().as_secs_f64();

        let success_rate = if total > 0 {
            success as f64 / total as f64 * 100.0
        } else {
            0.0
        };

        let avg_throughput_mbps = if elapsed > 0.0 {
            bytes as f64 / (1024.0 * 1024.0) / elapsed
        } else {
            0.0
        };

        let requests_per_second = if elapsed > 0.0 {
            total as f64 / elapsed
        } else {
            0.0
        };

        MetricsSnapshot {
            total_requests: total,
            successful_requests: success,
            failed_requests: failed,
            cached_requests: cached,
            blocked_by_robots: blocked,
            success_rate,
            total_bytes_downloaded: bytes,
            avg_throughput_mbps,
            elapsed_seconds: elapsed,
            requests_per_second,
        }
    }
}
