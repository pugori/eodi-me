package router

import (
	"time"

	"github.com/eodi-me/api-server/frontend"
	"github.com/eodi-me/api-server/internal/config"
	"github.com/eodi-me/api-server/internal/database"
	"github.com/eodi-me/api-server/internal/enginemgr"
	"github.com/eodi-me/api-server/internal/handlers"
	"github.com/eodi-me/api-server/internal/middleware"
	"github.com/gin-gonic/gin"
	"go.uber.org/zap"
)

// SetupRouter configures all routes and middleware
func SetupRouter(cfg *config.Config, db *database.DB, mgr *enginemgr.Manager, logger *zap.Logger) *gin.Engine {
	// Set Gin mode
	if cfg.GinMode == "release" {
		gin.SetMode(gin.ReleaseMode)
	}

	// Create router
	router := gin.New()

	// Global middleware
	router.Use(gin.Recovery())
	router.Use(middleware.RequestID())
	router.Use(middleware.SecurityHeaders())
	router.Use(middleware.PrometheusMetrics())
	router.Use(middleware.Logger(logger))
	router.Use(middleware.CORS(cfg))
	router.Use(middleware.MaxBodySize(10 << 20)) // 10 MB request body limit
	router.Use(middleware.Timeout(30 * time.Second))

	// Health and metrics endpoints (no auth)
	router.GET("/health", handlers.HealthCheck(db, logger))
	router.GET("/metrics", handlers.Metrics())
	router.GET("/engine/health", enginemgr.EngineHealthHandler(mgr))

	// Heartbeat endpoint for window-host keep-alive
	router.GET("/_hb", func(c *gin.Context) { c.Status(200) })

	// API routes — both /api and /api/v1 are supported for backward compatibility
	for _, prefix := range []string{"/api", "/api/v1"} {
		apiGroup := router.Group(prefix)
		apiGroup.Use(middleware.RateLimiter(cfg))
		registerAPIRoutes(apiGroup, db, mgr, logger, cfg)
	}

	// Engine proxy routes at root level (for Tauri frontend compatibility)
	registerEngineProxyRoutes(router, mgr, logger)

	// Serve embedded React SPA for all non-API routes
	if frontend.HasEmbeddedFrontend() {
		router.Use(frontend.ServeSPA())
		logger.Info("Embedded frontend SPA mounted")
	}

	return router
}

// registerAPIRoutes mounts all API handlers on the given route group.
func registerAPIRoutes(api *gin.RouterGroup, db *database.DB, mgr *enginemgr.Manager, logger *zap.Logger, cfg *config.Config) {
	// Cities endpoints (public) — only if database is available
	if db != nil {
		cities := api.Group("/cities")
		{
			cities.GET("/search", handlers.SearchCities(db, logger))
			cities.GET("/:city_id", handlers.GetCity(db, logger))
		}

		// Match endpoint (optional auth)
		api.POST("/match", handlers.FindMatches(db, logger))
	}

	// Hexagon endpoints (proxied to Rust engine)
	hexagons := api.Group("/hexagons")
	{
		hexagons.GET("/search", handlers.HexSearch(mgr, logger))
		hexagons.GET("/viewport", handlers.HexViewport(mgr, logger))
		hexagons.GET("/nearest", handlers.HexNearest(mgr, logger))
		hexagons.GET("/match", handlers.HexMatch(mgr, logger))
		hexagons.GET("/:h3", handlers.HexGet(mgr, logger))

		// User POI overlay (per-request, ephemeral)
		hexagons.PUT("/:h3/overlay", handlers.HexOverlaySet(mgr, logger))
		hexagons.GET("/:h3/overlay", handlers.HexOverlayGet(mgr, logger))
		hexagons.DELETE("/:h3/overlay", handlers.HexOverlayDelete(mgr, logger))
		hexagons.POST("/overlay/bulk", handlers.HexOverlayBulk(mgr, logger))
		hexagons.DELETE("/overlay", handlers.HexOverlayClear(mgr, logger))
	}

	// Protected endpoints (require JWT)
	protected := api.Group("")
	protected.Use(middleware.Auth(cfg))
	{
		protected.GET("/me", handlers.Me(logger))
	}

	// Coverage stats (public, no auth required)
	api.GET("/stats", handlers.Stats(db, mgr, logger))

	// Geocoding: address → H3 index (uses Nominatim + engine nearest)
	api.GET("/geocode/h3", handlers.GeocodeH3(mgr, logger))
}

// registerEngineProxyRoutes mounts engine proxy routes at root level.
// The Tauri frontend calls /hex/*, /search, /match directly (not /api/).
func registerEngineProxyRoutes(r *gin.Engine, mgr *enginemgr.Manager, logger *zap.Logger) {
	r.GET("/hex/viewport", handlers.HexViewport(mgr, logger))
	r.GET("/hex/search", handlers.HexSearch(mgr, logger))
	r.GET("/hex/nearest", handlers.HexNearest(mgr, logger))
	r.GET("/hex/match", handlers.HexMatch(mgr, logger))
	r.GET("/hex/:h3", handlers.HexGet(mgr, logger))
	r.GET("/search", handlers.HexSearch(mgr, logger))
	r.GET("/stats", handlers.EngineStats(mgr, logger))
	r.GET("/countries", handlers.EngineCountries(mgr, logger))
	r.GET("/cities", handlers.EngineCities(mgr, logger))
	r.GET("/geocode/h3", handlers.GeocodeH3(mgr, logger))
}
