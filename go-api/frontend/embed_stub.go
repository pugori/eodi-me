//go:build no_frontend

package frontend

import "github.com/gin-gonic/gin"

// Stub: no frontend assets embedded. Used for server-only builds
// that serve the API without the embedded SPA (e.g., Docker API-only mode).

// ServeSPA returns a no-op handler — no frontend embedded.
func ServeSPA() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Next()
	}
}

// HasEmbeddedFrontend returns false — no frontend in this build.
func HasEmbeddedFrontend() bool {
	return false
}
