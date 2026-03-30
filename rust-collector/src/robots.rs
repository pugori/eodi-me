//! robots.txt parser and cache — reserved for future crawl-policy enforcement.
#![allow(dead_code)]

use dashmap::DashMap;
use ahash::RandomState;
use reqwest::Client;
use std::time::Duration;
use tracing::{debug, warn};
use url::Url;

/// robots.txt parser and cache
pub struct RobotsStore {
    client: Client,
    user_agent: String,
    cache: DashMap<String, RobotsPolicy, RandomState>,
    timeout: Duration,
}

#[derive(Clone)]
struct RobotsPolicy {
    allowed_paths: Vec<String>,
    disallowed_paths: Vec<String>,
    crawl_delay: Option<f64>,
}

impl RobotsStore {
    pub fn new(client: Client, user_agent: String, timeout_secs: u64) -> Self {
        Self {
            client,
            user_agent,
            cache: DashMap::with_hasher(RandomState::new()),
            timeout: Duration::from_secs(timeout_secs),
        }
    }

    /// Extract domain from URL
    fn domain(url: &str) -> Option<String> {
        Url::parse(url)
            .ok()
            .and_then(|u| u.host_str().map(|h| h.to_lowercase()))
    }

    /// Check if URL is allowed by robots.txt
    pub async fn allowed(&self, url: &str) -> bool {
        let domain = match Self::domain(url) {
            Some(d) => d,
            None => return true, // No domain, allow
        };

        // Check cache
        if let Some(policy) = self.cache.get(&domain) {
            return self.check_policy(&policy, url);
        }

        // Fetch and parse robots.txt
        let robots_url = format!("https://{}/robots.txt", domain);
        let policy = match self.fetch_robots(&robots_url).await {
            Ok(p) => p,
            Err(e) => {
                warn!("Failed to fetch robots.txt for {}: {}", domain, e);
                // On error, be permissive
                RobotsPolicy {
                    allowed_paths: vec![],
                    disallowed_paths: vec![],
                    crawl_delay: None,
                }
            }
        };

        let allowed = self.check_policy(&policy, url);
        self.cache.insert(domain, policy);

        allowed
    }

    /// Fetch and parse robots.txt
    async fn fetch_robots(&self, robots_url: &str) -> anyhow::Result<RobotsPolicy> {
        let response = self
            .client
            .get(robots_url)
            .timeout(self.timeout)
            .send()
            .await?;

        let text = response.text().await?;
        Ok(self.parse_robots(&text))
    }

    /// Parse robots.txt content (simplified parser)
    fn parse_robots(&self, content: &str) -> RobotsPolicy {
        let mut allowed_paths = Vec::new();
        let mut disallowed_paths = Vec::new();
        let mut crawl_delay = None;
        let mut relevant_section = false;

        for line in content.lines() {
            let line = line.trim();

            // User-agent directive
            if line.to_lowercase().starts_with("user-agent:") {
                let agent = line["user-agent:".len()..].trim();
                relevant_section = agent == "*" || agent.to_lowercase() == self.user_agent.to_lowercase();
                continue;
            }

            if !relevant_section {
                continue;
            }

            // Disallow directive
            if line.to_lowercase().starts_with("disallow:") {
                let path = line["disallow:".len()..].trim();
                if !path.is_empty() {
                    disallowed_paths.push(path.to_string());
                }
            }

            // Allow directive
            if line.to_lowercase().starts_with("allow:") {
                let path = line["allow:".len()..].trim();
                if !path.is_empty() {
                    allowed_paths.push(path.to_string());
                }
            }

            // Crawl-delay directive
            if line.to_lowercase().starts_with("crawl-delay:") {
                let delay_str = line["crawl-delay:".len()..].trim();
                if let Ok(delay) = delay_str.parse::<f64>() {
                    crawl_delay = Some(delay);
                }
            }
        }

        RobotsPolicy {
            allowed_paths,
            disallowed_paths,
            crawl_delay,
        }
    }

    /// Check if URL matches policy
    fn check_policy(&self, policy: &RobotsPolicy, url: &str) -> bool {
        let url_obj = match Url::parse(url) {
            Ok(u) => u,
            Err(_) => return true,
        };

        let path = url_obj.path();

        // Check explicit allows (takes precedence over disallows)
        for allowed in &policy.allowed_paths {
            if path.starts_with(allowed) {
                debug!("robots.txt: {} allowed by rule: {}", url, allowed);
                return true;
            }
        }

        // Check disallows
        for disallowed in &policy.disallowed_paths {
            if disallowed == "/" || path.starts_with(disallowed) {
                debug!("robots.txt: {} blocked by rule: {}", url, disallowed);
                return false;
            }
        }

        // Default: allowed
        true
    }

    /// Get crawl delay for domain (if specified in robots.txt)
    pub fn crawl_delay(&self, url: &str) -> Option<f64> {
        let domain = Self::domain(url)?;
        self.cache.get(&domain).and_then(|p| p.crawl_delay)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_robots() {
        let content = r#"
User-agent: *
Disallow: /admin
Allow: /public
Crawl-delay: 1.5
        "#;

        let store = RobotsStore::new(
            Client::new(),
            "test-bot".to_string(),
            10,
        );

        let policy = store.parse_robots(content);
        assert_eq!(policy.disallowed_paths, vec!["/admin"]);
        assert_eq!(policy.allowed_paths, vec!["/public"]);
        assert_eq!(policy.crawl_delay, Some(1.5));
    }
}
