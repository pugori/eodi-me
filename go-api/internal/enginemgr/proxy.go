package enginemgr

import (
	"io"
	"net/http"

	"github.com/gin-gonic/gin"
	"go.uber.org/zap"
)

// ProxyHandler creates a Gin handler that proxies requests to the engine.
// The engine path is taken directly from c.Request.URL.Path.
// If the engine is not available, it falls back to the provided fallback handler.
func ProxyHandler(mgr *Manager, fallback gin.HandlerFunc, logger *zap.Logger) gin.HandlerFunc {
	return proxyWithPathFn(mgr, fallback, logger, func(c *gin.Context) string {
		return c.Request.URL.Path
	})
}

// ProxyHandlerTo proxies requests to a fixed engine path, appending gin params.
// e.g. ProxyHandlerTo(mgr, nil, logger, "/hex/search") maps GET /api/hexagons/search → GET /hex/search
func ProxyHandlerTo(mgr *Manager, fallback gin.HandlerFunc, logger *zap.Logger, enginePath string) gin.HandlerFunc {
	return proxyWithPathFn(mgr, fallback, logger, func(_ *gin.Context) string {
		return enginePath
	})
}

// ProxyHandlerToParam proxies to an engine path with one gin URL param substituted.
// e.g. ProxyHandlerToParam(mgr, nil, logger, "/hex/", "h3") maps GET /api/hexagons/:h3 → GET /hex/:h3
func ProxyHandlerToParam(mgr *Manager, fallback gin.HandlerFunc, logger *zap.Logger, enginePrefix, paramName string) gin.HandlerFunc {
	return proxyWithPathFn(mgr, fallback, logger, func(c *gin.Context) string {
		return enginePrefix + c.Param(paramName)
	})
}

func proxyWithPathFn(mgr *Manager, fallback gin.HandlerFunc, logger *zap.Logger, pathFn func(*gin.Context) string) gin.HandlerFunc {
	return func(c *gin.Context) {
		if mgr == nil || !mgr.IsReady() {
			if fallback != nil {
				fallback(c)
			} else {
				c.JSON(http.StatusServiceUnavailable, gin.H{
					"error": "Engine not available",
				})
			}
			return
		}

		resp, err := mgr.ProxyRequest(
			c.Request.Context(),
			c.Request.Method,
			pathFn(c),
			c.Request.URL.RawQuery,
			c.Request.Body,
		)
		if err != nil {
			logger.Error("Engine proxy failed",
				zap.Error(err),
				zap.String("path", c.Request.URL.Path),
			)
			if fallback != nil {
				fallback(c)
			} else {
				c.JSON(http.StatusBadGateway, gin.H{
					"error": "Engine proxy failed",
				})
			}
			return
		}
		defer resp.Body.Close()

		for key, values := range resp.Header {
			for _, v := range values {
				c.Header(key, v)
			}
		}

		c.Status(resp.StatusCode)
		if _, err := io.Copy(c.Writer, resp.Body); err != nil {
			logger.Error("Failed to copy engine response",
				zap.Error(err),
				zap.String("path", c.Request.URL.Path),
			)
		}
	}
}

// EngineHealthHandler returns engine health status.
func EngineHealthHandler(mgr *Manager) gin.HandlerFunc {
	return func(c *gin.Context) {
		if mgr == nil || !mgr.IsReady() {
			c.JSON(http.StatusServiceUnavailable, gin.H{
				"engine": "not_available",
				"mode":   "offline",
			})
			return
		}

		err := mgr.HealthCheck()
		if err != nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{
				"engine": "error",
				"error":  err.Error(),
				"mode":   "offline",
			})
			return
		}

		c.JSON(http.StatusOK, gin.H{
			"engine": "ok",
			"port":   mgr.Port(),
			"mode":   "encrypted_engine",
		})
	}
}
