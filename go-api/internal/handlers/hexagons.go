package handlers

import (
	"io"
	"net/http"
	"regexp"
	"strconv"

	"github.com/eodi-me/api-server/internal/enginemgr"
	"github.com/gin-gonic/gin"
	"go.uber.org/zap"
)

// h3HexRe matches the traditional H3 hex string format: exactly 15 lowercase hex characters.
var h3HexRe = regexp.MustCompile(`^[0-9a-f]{15}$`)

// validateH3 checks that the :h3 path param is a valid H3 cell index.
// Accepts two formats:
//   - Hex string (15 lowercase hex chars): "8830e1d8c1fffff"
//   - Decimal u64 string: "613349494320267263" (returned by the engine's own JSON)
//
// Returns false and writes a 400 response if invalid.
func validateH3(c *gin.Context) bool {
	h3 := c.Param("h3")
	// Accept hex format
	if h3HexRe.MatchString(h3) {
		return true
	}
	// Accept decimal u64 format
	if _, err := strconv.ParseUint(h3, 10, 64); err == nil {
		return true
	}
	c.JSON(http.StatusBadRequest, gin.H{"error": "invalid h3 index format"})
	return false
}

// HexSearch handles GET /api/hexagons/search
// Params: q, limit, country, city
func HexSearch(mgr *enginemgr.Manager, logger *zap.Logger) gin.HandlerFunc {
	return enginemgr.ProxyHandlerTo(mgr, nil, logger, "/hex/search")
}

// HexViewport handles GET /api/hexagons/viewport
// Params: north, south, east, west, zoom, limit
func HexViewport(mgr *enginemgr.Manager, logger *zap.Logger) gin.HandlerFunc {
	proxy := enginemgr.ProxyHandlerTo(mgr, nil, logger, "/hex/viewport")
	return func(c *gin.Context) {
		parseFloat := func(name string) (float64, bool) {
			raw := c.Query(name)
			if raw == "" {
				c.JSON(http.StatusBadRequest, gin.H{"error": name + " is required"})
				return 0, false
			}
			v, err := strconv.ParseFloat(raw, 64)
			if err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"error": name + " must be a valid number"})
				return 0, false
			}
			return v, true
		}

		north, ok := parseFloat("north")
		if !ok {
			return
		}
		south, ok := parseFloat("south")
		if !ok {
			return
		}
		east, ok := parseFloat("east")
		if !ok {
			return
		}
		west, ok := parseFloat("west")
		if !ok {
			return
		}

		if north <= south {
			c.JSON(http.StatusBadRequest, gin.H{"error": "north must be greater than south"})
			return
		}
		if north < -90 || north > 90 || south < -90 || south > 90 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "latitude must be between -90 and 90"})
			return
		}
		if east < -180 || east > 180 || west < -180 || west > 180 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "longitude must be between -180 and 180"})
			return
		}

		if raw := c.Query("zoom"); raw != "" {
			zoom, err := strconv.Atoi(raw)
			if err != nil || zoom < 1 || zoom > 20 {
				c.JSON(http.StatusBadRequest, gin.H{"error": "zoom must be between 1 and 20"})
				return
			}
		}

		proxy(c)
	}
}

// HexNearest handles GET /api/hexagons/nearest
// Params: lat, lon, k
func HexNearest(mgr *enginemgr.Manager, logger *zap.Logger) gin.HandlerFunc {
	return enginemgr.ProxyHandlerTo(mgr, nil, logger, "/hex/nearest")
}

// HexMatch handles GET /api/hexagons/match
// Params: h3_index, top_k
func HexMatch(mgr *enginemgr.Manager, logger *zap.Logger) gin.HandlerFunc {
	return enginemgr.ProxyHandlerTo(mgr, nil, logger, "/hex/match")
}

// EngineStats proxies GET /stats to the Rust engine to expose
// total_hexagons, total_cities, spec_version, built_at, etc.
func EngineStats(mgr *enginemgr.Manager, logger *zap.Logger) gin.HandlerFunc {
	return enginemgr.ProxyHandlerTo(mgr, nil, logger, "/stats")
}

// EngineCountries proxies GET /countries to list all country codes in the hex DB.
func EngineCountries(mgr *enginemgr.Manager, logger *zap.Logger) gin.HandlerFunc {
	return enginemgr.ProxyHandlerTo(mgr, nil, logger, "/countries")
}

// EngineCities proxies GET /cities?country=XX to list cities for a country.
func EngineCities(mgr *enginemgr.Manager, logger *zap.Logger) gin.HandlerFunc {
	return enginemgr.ProxyHandlerTo(mgr, nil, logger, "/cities")
}

// HexGet handles GET /api/hexagons/:h3
func HexGet(mgr *enginemgr.Manager, logger *zap.Logger) gin.HandlerFunc {
	return func(c *gin.Context) {
		if !validateH3(c) {
			return
		}
		enginemgr.ProxyHandlerToParam(mgr, nil, logger, "/hex/", "h3")(c)
	}
}

// overlayPath builds the engine path for a single hex overlay: /user/hex/:h3
func overlayPath(c *gin.Context) string {
	return "/user/hex/" + c.Param("h3")
}

// HexOverlaySet handles PUT /api/hexagons/:h3/overlay
// Body: {"poi_counts": [vitality, culture, relief, rhythm, lifestyle, commercial, total]}
func HexOverlaySet(mgr *enginemgr.Manager, logger *zap.Logger) gin.HandlerFunc {
	return func(c *gin.Context) {
		if !validateH3(c) {
			return
		}
		proxyTo(mgr, logger, c, http.MethodPut, overlayPath(c))
	}
}

// HexOverlayGet handles GET /api/hexagons/:h3/overlay
func HexOverlayGet(mgr *enginemgr.Manager, logger *zap.Logger) gin.HandlerFunc {
	return func(c *gin.Context) {
		if !validateH3(c) {
			return
		}
		proxyTo(mgr, logger, c, http.MethodGet, overlayPath(c))
	}
}

// HexOverlayDelete handles DELETE /api/hexagons/:h3/overlay
func HexOverlayDelete(mgr *enginemgr.Manager, logger *zap.Logger) gin.HandlerFunc {
	return func(c *gin.Context) {
		if !validateH3(c) {
			return
		}
		proxyTo(mgr, logger, c, http.MethodDelete, overlayPath(c))
	}
}

// HexOverlayBulk handles POST /api/hexagons/overlay/bulk
// Body: {"overlays": {"h3_index": [counts...], ...}}
func HexOverlayBulk(mgr *enginemgr.Manager, logger *zap.Logger) gin.HandlerFunc {
	return func(c *gin.Context) {
		proxyTo(mgr, logger, c, http.MethodPost, "/user/hexagons/bulk")
	}
}

// HexOverlayClear handles DELETE /api/hexagons/overlay
// Clears all user overlay data for the session.
func HexOverlayClear(mgr *enginemgr.Manager, logger *zap.Logger) gin.HandlerFunc {
	return func(c *gin.Context) {
		proxyTo(mgr, logger, c, http.MethodDelete, "/user/clear")
	}
}

// proxyTo is the low-level proxy helper used by overlay handlers.
func proxyTo(mgr *enginemgr.Manager, logger *zap.Logger, c *gin.Context, method, enginePath string) {
	if mgr == nil || !mgr.IsReady() {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Engine not available"})
		return
	}

	resp, err := mgr.ProxyRequest(c.Request.Context(), method, enginePath, c.Request.URL.RawQuery, c.Request.Body)
	if err != nil {
		logger.Error("Engine proxy failed", zap.Error(err), zap.String("path", enginePath))
		c.JSON(http.StatusBadGateway, gin.H{"error": "Engine proxy failed"})
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
		logger.Error("Failed to copy engine response", zap.Error(err))
	}
}
