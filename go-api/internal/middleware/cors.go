package middleware

import (
	"time"

	"github.com/eodi-me/api-server/internal/config"
	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
)

// CORS is a middleware that handles Cross-Origin Resource Sharing.
// In development (empty ALLOW_ORIGIN), allows localhost origins only.
// In production, requires explicit ALLOW_ORIGIN to be set.
func CORS(cfg *config.Config) gin.HandlerFunc {
	origins := cfg.AllowOrigins
	// Filter out empty strings
	filtered := make([]string, 0, len(origins))
	for _, o := range origins {
		if o != "" {
			filtered = append(filtered, o)
		}
	}
	// Dev fallback — allow localhost variants only
	if len(filtered) == 0 {
		filtered = []string{
			"http://localhost:5173",
			"http://127.0.0.1:5173",
			"http://localhost:1420",
			"http://127.0.0.1:1420",
			"http://localhost:8000",
			"http://127.0.0.1:8000",
		}
	}

	return cors.New(cors.Config{
		AllowOrigins:     filtered,
		AllowMethods:     []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowHeaders:     []string{"Origin", "Content-Type", "Authorization"},
		ExposeHeaders:    []string{"Content-Length"},
		AllowCredentials: true,
		MaxAge:           12 * time.Hour,
	})
}
