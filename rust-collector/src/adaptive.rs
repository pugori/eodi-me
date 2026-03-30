use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{Semaphore, RwLock};
use tokio::time::interval;
use tracing::{info, debug};
use crate::resources::ResourceManager;

/// Adaptive worker pool with dynamic concurrency based on system resources
pub struct AdaptiveWorkerPool {
    semaphore: Arc<Semaphore>,
    current_workers: Arc<RwLock<usize>>,
    resource_manager: Arc<RwLock<ResourceManager>>,
    min_workers: usize,
    max_workers: usize,
    monitoring_enabled: Arc<RwLock<bool>>,
}

impl AdaptiveWorkerPool {
    pub fn new(min_workers: usize, max_workers: usize, worker_memory_mb: u64) -> Self {
        let resource_manager = ResourceManager::new(worker_memory_mb);
        let initial_workers = min_workers.max(1);
        
        info!("🤖 Adaptive Worker Pool initialized");
        info!("   Min workers: {}", min_workers);
        info!("   Max workers: {}", max_workers);
        info!("   Initial workers: {}", initial_workers);
        
        Self {
            semaphore: Arc::new(Semaphore::new(initial_workers)),
            current_workers: Arc::new(RwLock::new(initial_workers)),
            resource_manager: Arc::new(RwLock::new(resource_manager)),
            min_workers,
            max_workers,
            monitoring_enabled: Arc::new(RwLock::new(true)),
        }
    }

    /// Start background monitoring task
    pub fn start_monitoring(&self) {
        let semaphore = self.semaphore.clone();
        let current_workers = self.current_workers.clone();
        let resource_manager = self.resource_manager.clone();
        let min_workers = self.min_workers;
        let max_workers = self.max_workers;
        let monitoring_enabled = self.monitoring_enabled.clone();

        tokio::spawn(async move {
            let mut ticker = interval(Duration::from_secs(5));
            
            loop {
                ticker.tick().await;
                
                // Check if monitoring is still enabled
                if !*monitoring_enabled.read().await {
                    debug!("Monitoring stopped");
                    break;
                }

                // Get system metrics
                let mut rm = resource_manager.write().await;
                let suggested = rm.suggested_workers();
                let is_overloaded = rm.is_overloaded();
                drop(rm);

                // Calculate target workers
                let target = if is_overloaded {
                    // Scale down if overloaded
                    let current = *current_workers.read().await;
                    (current.saturating_sub(1)).max(min_workers)
                } else {
                    // Use suggested workers bounded by min/max
                    suggested.max(min_workers).min(max_workers)
                };

                let current = *current_workers.read().await;
                
                if target != current {
                    info!("🔄 Adjusting workers: {} → {} {}", 
                        current, 
                        target,
                        if is_overloaded { "(overload detected)" } else { "" }
                    );
                    
                    // Adjust semaphore permits
                    if target > current {
                        // Add permits
                        semaphore.add_permits(target - current);
                    } else {
                        // Remove permits by acquiring and forgetting
                        for _ in 0..(current - target) {
                            if let Ok(permit) = semaphore.try_acquire() {
                                permit.forget();
                            }
                        }
                    }
                    
                    *current_workers.write().await = target;
                } else {
                    debug!("Workers stable at {}", current);
                }
            }
        });
    }

    /// Stop monitoring
    pub async fn stop_monitoring(&self) {
        *self.monitoring_enabled.write().await = false;
    }

    /// Acquire a worker permit
    pub async fn acquire(&self) -> tokio::sync::SemaphorePermit<'_> {
        self.semaphore.acquire().await.expect("Semaphore closed")
    }

    /// Try to acquire a worker permit without waiting (reserved for future use).
    #[allow(dead_code)]
    pub fn try_acquire(&self) -> Option<tokio::sync::SemaphorePermit<'_>> {
        self.semaphore.try_acquire().ok()
    }

    /// Get current worker count
    pub async fn current_workers(&self) -> usize {
        *self.current_workers.read().await
    }

    /// Get system metrics
    pub async fn get_metrics(&self) -> SystemMetrics {
        let mut rm = self.resource_manager.write().await;
        rm.system.refresh_all();
        
        let cpu_count = rm.system.cpus().len();
        let cpu_usage: f32 = rm.system.cpus()
            .iter()
            .map(|p| p.cpu_usage())
            .sum::<f32>() / cpu_count as f32;
        let total_memory_mb = rm.system.total_memory() / (1024 * 1024);
        let available_memory_mb = rm.system.available_memory() / (1024 * 1024);
        let used_memory_mb = total_memory_mb - available_memory_mb;
        let memory_usage_percent = (used_memory_mb as f32 / total_memory_mb as f32) * 100.0;
        
        SystemMetrics {
            cpu_count,
            cpu_usage,
            total_memory_mb,
            available_memory_mb,
            memory_usage_percent,
            current_workers: *self.current_workers.read().await,
        }
    }
}

#[derive(Debug, Clone)]
pub struct SystemMetrics {
    pub cpu_count: usize,
    pub cpu_usage: f32,
    pub total_memory_mb: u64,
    pub available_memory_mb: u64,
    pub memory_usage_percent: f32,
    pub current_workers: usize,
}

impl SystemMetrics {
    pub fn log(&self) {
        info!("📊 System Metrics:");
        info!("   CPU: {:.1}% ({} cores)", self.cpu_usage, self.cpu_count);
        info!("   Memory: {:.1}% ({} MB / {} MB)", 
            self.memory_usage_percent, 
            self.total_memory_mb - self.available_memory_mb,
            self.total_memory_mb
        );
        info!("   Workers: {}", self.current_workers);
    }
}
