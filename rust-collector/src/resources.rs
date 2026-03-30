use sysinfo::System;
use tracing::{debug, warn};

/// Monitor system resources and suggest optimal worker count
pub struct ResourceManager {
    pub system: System,
    worker_memory_mb: u64,
}

impl ResourceManager {
    pub fn new(worker_memory_mb: u64) -> Self {
        Self {
            system: System::new_all(),
            worker_memory_mb,
        }
    }

    /// Calculate optimal worker count based on CPU and available memory
    pub fn suggested_workers(&mut self) -> usize {
        self.system.refresh_all();

        let cpu_count = self.system.cpus().len();
        let available_mb = self.system.available_memory() / (1024 * 1024);

        // Memory-based limit: available RAM / per-worker memory
        let mem_based = (available_mb / self.worker_memory_mb).max(1);

        // Allow up to 2x logical cores, bounded by memory
        let suggested = mem_based.min((cpu_count * 2) as u64).max(1) as usize;

        debug!(
            "Resource check - CPU: {}, Available RAM: {} MB, Suggested workers: {}",
            cpu_count, available_mb, suggested
        );

        suggested
    }

    /// Check if system is under high load
    pub fn is_overloaded(&mut self) -> bool {
        self.system.refresh_cpu();
        
        // Consider system overloaded if CPU usage > 90%
        let cpu_usage: f32 = self.system.cpus()
            .iter()
            .map(|p| p.cpu_usage())
            .sum::<f32>() / self.system.cpus().len() as f32;

        if cpu_usage > 90.0 {
            warn!("System CPU usage high: {:.1}%", cpu_usage);
            return true;
        }

        // Or if available memory < 500 MB
        let available_mb = self.system.available_memory() / (1024 * 1024);
        if available_mb < 500 {
            warn!("Low memory: {} MB available", available_mb);
            return true;
        }

        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_suggested_workers() {
        let mut rm = ResourceManager::new(200);
        let workers = rm.suggested_workers();
        assert!(workers >= 1);
        assert!(workers <= 32); // Reasonable upper bound
    }
}
