//go:build !no_frontend

package frontend

import (
	"embed"
	"io/fs"
	"log"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

//go:embed dist/*
var staticFiles embed.FS

// ServeSPA returns a Gin handler that serves the embedded React SPA.
// API routes (/api/*, /health, /metrics, /search, /match, /city/*) are excluded.
// All other routes fall back to index.html for client-side routing.
func ServeSPA() gin.HandlerFunc {
	// Strip "dist/" prefix so files are served from root
	sub, err := fs.Sub(staticFiles, "dist")
	if err != nil {
		log.Fatalf("failed to create sub filesystem for embedded frontend: %v", err)
	}

	fileServer := http.FileServer(http.FS(sub))

	return func(c *gin.Context) {
		path := c.Request.URL.Path

		// Skip API routes — let Gin handle them
		if strings.HasPrefix(path, "/api/") ||
			path == "/health" ||
			path == "/metrics" ||
			strings.HasPrefix(path, "/search") ||
			strings.HasPrefix(path, "/match") ||
			strings.HasPrefix(path, "/city/") {
			c.Next()
			return
		}

		// Try to serve the static file
		// If the file doesn't exist, serve index.html (SPA fallback)
		if path != "/" {
			// Check if file exists in embedded FS
			cleanPath := strings.TrimPrefix(path, "/")
			if _, err := fs.Stat(sub, cleanPath); err == nil {
				fileServer.ServeHTTP(c.Writer, c.Request)
				c.Abort()
				return
			}
		} else {
			// Serve root index.html
			fileServer.ServeHTTP(c.Writer, c.Request)
			c.Abort()
			return
		}

		// SPA fallback: serve index.html for unknown paths
		c.Request.URL.Path = "/"
		fileServer.ServeHTTP(c.Writer, c.Request)
		c.Abort()
	}
}

// HasEmbeddedFrontend returns true if the dist/ directory contains files.
func HasEmbeddedFrontend() bool {
	entries, err := fs.ReadDir(staticFiles, "dist")
	if err != nil {
		return false
	}
	return len(entries) > 0
}
