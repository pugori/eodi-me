use dashmap::DashMap;
use ahash::RandomState;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tokio::time::sleep;
use tracing::{debug, info};
use url::Url;

/// Per-domain rate limiter using slot-reservation.
///
/// Each call to `await_slot` atomically reserves the NEXT available time slot
/// for that domain, then sleeps until that slot arrives.  N concurrent workers
/// are automatically serialised into a queue spaced `delay` apart.
///
/// Example: delay=8s, 4 workers arrive simultaneously
///   Worker 1 → slot t+0s  (no sleep)
///   Worker 2 → slot t+8s  (sleeps 8s)
///   Worker 3 → slot t+16s (sleeps 16s)
///   Worker 4 → slot t+24s (sleeps 24s)
pub struct DomainRateLimiter {
    data: DashMap<String, Mutex<DomainInfo>, RandomState>,
    default_delay: Duration,
    max_delay: Duration,
}

struct DomainInfo {
    /// Earliest time the NEXT request may fire. Advanced by `delay` per reservation.
    next_allowed: Instant,
    delay: Duration,
}

impl DomainRateLimiter {
    pub fn new(default_delay_secs: f64, max_delay_secs: f64) -> Self {
        Self {
            data: DashMap::with_hasher(RandomState::new()),
            default_delay: Duration::from_secs_f64(default_delay_secs),
            max_delay: Duration::from_secs_f64(max_delay_secs),
        }
    }

    /// Extract domain from URL
    fn domain(url: &str) -> Option<String> {
        Url::parse(url)
            .ok()
            .and_then(|u| u.host_str().map(|h| h.to_lowercase()))
    }

    /// Reserve the next slot for this domain and sleep until it arrives.
    /// Lock is held only for the slot calculation (µs), never during sleep.
    pub async fn await_slot(&self, url: &str) {
        let domain = match Self::domain(url) {
            Some(d) => d,
            None => return,
        };

        let my_slot: Instant = {
            let entry = self.data.entry(domain.clone()).or_insert_with(|| {
                Mutex::new(DomainInfo {
                    next_allowed: Instant::now(),
                    delay: self.default_delay,
                })
            });
            let mut info = entry.lock().unwrap();
            let now = Instant::now();
            // my slot = max(now, next_allowed)
            let slot = info.next_allowed.max(now);
            // reserve: next worker queues after me
            info.next_allowed = slot + info.delay;
            slot
        };

        let now = Instant::now();
        if my_slot > now {
            let wait = my_slot - now;
            debug!("Rate limiting {}: waiting {:.2}s", domain, wait.as_secs_f64());
            sleep(wait).await;
        }
    }

    /// Double the delay after a 429.  Also pushes `next_allowed` forward so
    /// already-queued requests don't fire before the back-off period ends.
    pub fn back_off(&self, url: &str) {
        let domain = match Self::domain(url) {
            Some(d) => d,
            None => return,
        };
        let entry = self.data.entry(domain.clone()).or_insert_with(|| {
            Mutex::new(DomainInfo { next_allowed: Instant::now(), delay: self.default_delay })
        });
        let mut info = entry.lock().unwrap();
        let new_delay = (info.delay * 2).min(self.max_delay);
        info.delay = new_delay;
        let floor = Instant::now() + new_delay;
        if info.next_allowed < floor {
            info.next_allowed = floor;
        }
        info!("⚠️  429 back-off {}: delay → {:.1}s", domain, new_delay.as_secs_f64());
    }

    /// Set crawl delay for domain (e.g. from robots.txt Crawl-delay).
    pub fn set_delay(&self, url: &str, delay_secs: f64) {
        let domain = match Self::domain(url) {
            Some(d) => d,
            None => return,
        };
        let delay = Duration::from_secs_f64(delay_secs.clamp(0.1, self.max_delay.as_secs_f64()));
        self.data
            .entry(domain.clone())
            .and_modify(|m| m.get_mut().unwrap().delay = delay)
            .or_insert_with(|| Mutex::new(DomainInfo { next_allowed: Instant::now(), delay }));
        info!("Set crawl delay for {}: {:.2}s", domain, delay.as_secs_f64());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_slot_serialisation() {
        let limiter = DomainRateLimiter::new(0.1, 60.0);
        let url = "https://example.com/test";
        let start = Instant::now();
        limiter.await_slot(url).await;
        limiter.await_slot(url).await;
        assert!(start.elapsed() >= Duration::from_millis(95));
    }

    #[test]
    fn test_set_delay() {
        let limiter = DomainRateLimiter::new(1.0, 60.0);
        limiter.set_delay("https://example.com/test", 2.5);
        let d = limiter.data.get("example.com").unwrap().lock().unwrap().delay.as_secs_f64();
        assert!((d - 2.5).abs() < 0.01);
    }

    #[test]
    fn test_back_off_doubles() {
        let limiter = DomainRateLimiter::new(1.0, 60.0);
        limiter.back_off("https://example.com/");
        let d = limiter.data.get("example.com").unwrap().lock().unwrap().delay;
        assert_eq!(d, Duration::from_secs(2));
        limiter.back_off("https://example.com/");
        let d = limiter.data.get("example.com").unwrap().lock().unwrap().delay;
        assert_eq!(d, Duration::from_secs(4));
    }
}
