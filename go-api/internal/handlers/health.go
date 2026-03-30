package handlers

import (
	"fmt"
	"net/http"
	"runtime"
	"time"

	"github.com/eodi-me/api-server/internal/database"
	"github.com/gin-gonic/gin"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"go.uber.org/zap"
)

var startTime = time.Now()

// AppVersion is set from main.Version at startup for inclusion in health responses.
var AppVersion = "dev"

// HealthCheck handles GET /health
func HealthCheck(db *database.DB, logger *zap.Logger) gin.HandlerFunc {
	return func(c *gin.Context) {
		// Check database connection
		dbStatus := "connected"
		if db == nil {
			dbStatus = "unavailable"
		} else if err := db.Ping(); err != nil {
			dbStatus = "disconnected"
			if logger != nil {
				logger.Error("Database ping failed", zap.Error(err))
			}
		}

		uptime := time.Since(startTime)

		c.JSON(http.StatusOK, gin.H{
			"status":   "healthy",
			"database": dbStatus,
			"uptime":   uptime.String(),
			"version":  AppVersion,
		})
	}
}

// Metrics handles GET /metrics — exposes Prometheus metrics in text exposition format.
// Falls back to a JSON runtime summary if the Accept header requests JSON.
func Metrics() gin.HandlerFunc {
	promHandler := promhttp.Handler()
	return func(c *gin.Context) {
		accept := c.GetHeader("Accept")
		if accept == "application/json" {
			// JSON fallback for tools that can't parse Prometheus exposition format
			var m runtime.MemStats
			runtime.ReadMemStats(&m)
			c.JSON(http.StatusOK, gin.H{
				"memory": gin.H{
					"alloc_mb":       m.Alloc / 1024 / 1024,
					"total_alloc_mb": m.TotalAlloc / 1024 / 1024,
					"sys_mb":         m.Sys / 1024 / 1024,
					"num_gc":         m.NumGC,
				},
				"goroutines": runtime.NumGoroutine(),
				"uptime":     fmt.Sprintf("%.0fs", time.Since(startTime).Seconds()),
				"version":    AppVersion,
			})
			return
		}
		// Default: Prometheus text exposition format (scraped by Prometheus server)
		promHandler.ServeHTTP(c.Writer, c.Request)
	}
}
