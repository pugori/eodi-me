package middleware

import (
	"fmt"
	"time"

	"github.com/eodi-me/api-server/internal/metrics"
	"github.com/gin-gonic/gin"
)

// PrometheusMetrics records per-request Prometheus counters and histograms.
// It should be registered before route-specific middleware for accurate timing.
func PrometheusMetrics() gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		path := c.FullPath()
		if path == "" {
			path = "unknown"
		}
		method := c.Request.Method

		metrics.ActiveRequests.Inc()
		defer metrics.ActiveRequests.Dec()

		c.Next()

		duration := time.Since(start).Seconds()
		status := fmt.Sprintf("%d", c.Writer.Status())

		metrics.HTTPRequestsTotal.WithLabelValues(method, path, status).Inc()
		metrics.HTTPRequestDuration.WithLabelValues(method, path).Observe(duration)
	}
}
