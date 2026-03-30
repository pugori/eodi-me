package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/eodi-me/api-server/internal/enginemgr"
	"github.com/gin-gonic/gin"
	"go.uber.org/zap"
)

// geocodeClient is a dedicated HTTP client for external Nominatim calls.
var geocodeClient = &http.Client{
	Timeout: 8 * time.Second,
}

// nominatimResult is the subset of fields we need from Nominatim's JSON response.
type nominatimResult struct {
	Lat         string `json:"lat"`
	Lon         string `json:"lon"`
	DisplayName string `json:"display_name"`
	Class       string `json:"class"`
	Type        string `json:"type"`
}

// GeocodeH3Response is the JSON we return to the frontend.
type GeocodeH3Response struct {
	H3          string  `json:"h3"`
	Lat         float64 `json:"lat"`
	Lng         float64 `json:"lng"`
	DisplayName string  `json:"display_name"`
}

// GeocodeH3 handles GET /geocode/h3?q=<address>
//
// Flow:
//  1. Call Nominatim (OSM) to resolve address → lat/lng
//  2. Call engine /hex/nearest?lat=&lon= to get the H3 index for that point
//  3. Return h3, lat, lng, display_name to the caller
//
// No API key required. Rate-limited to Nominatim's fair-use policy (1 req/s) by
// the existing go-api rate limiter middleware.
func GeocodeH3(mgr *enginemgr.Manager, logger *zap.Logger) gin.HandlerFunc {
	return func(c *gin.Context) {
		q := strings.TrimSpace(c.Query("q"))
		if q == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "q parameter is required"})
			return
		}

		// 1. Nominatim geocoding
		nomURL := "https://nominatim.openstreetmap.org/search?format=json&limit=1&q=" +
			url.QueryEscape(q)
		ctx, cancel := context.WithTimeout(c.Request.Context(), 7*time.Second)
		defer cancel()

		nomReq, err := http.NewRequestWithContext(ctx, http.MethodGet, nomURL, nil)
		if err != nil {
			logger.Error("Failed to create Nominatim request", zap.Error(err))
			c.JSON(http.StatusInternalServerError, gin.H{"error": "geocoding request failed"})
			return
		}
		// Nominatim policy requires a valid User-Agent identifying the app.
		nomReq.Header.Set("User-Agent", "eodi.me/1.0 (hello@eodi.me)")

		nomResp, err := geocodeClient.Do(nomReq)
		if err != nil {
			logger.Warn("Nominatim call failed", zap.Error(err), zap.String("q", q))
			c.JSON(http.StatusBadGateway, gin.H{"error": "geocoding service unavailable"})
			return
		}
		defer nomResp.Body.Close()

		body, err := io.ReadAll(io.LimitReader(nomResp.Body, 1<<16)) // max 64 KB
		if err != nil {
			c.JSON(http.StatusBadGateway, gin.H{"error": "failed to read geocoding response"})
			return
		}

		var results []nominatimResult
		if err := json.Unmarshal(body, &results); err != nil || len(results) == 0 {
			c.JSON(http.StatusNotFound, gin.H{"error": "address not found"})
			return
		}
		hit := results[0]

		// 2. Convert lat/lng to H3 via the engine
		var lat, lng float64
		if _, err := fmt.Sscanf(hit.Lat, "%f", &lat); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "invalid lat from geocoder"})
			return
		}
		if _, err := fmt.Sscanf(hit.Lon, "%f", &lng); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "invalid lon from geocoder"})
			return
		}

		engineQuery := fmt.Sprintf("lat=%v&lon=%v&k=1", lat, lng)
		engineResp, err := mgr.ProxyRequest(c.Request.Context(), http.MethodGet, "/hex/nearest", engineQuery, nil)
		if err != nil {
			logger.Warn("Engine nearest proxy failed", zap.Error(err))
			// Fallback: return lat/lng without H3
			c.JSON(http.StatusOK, GeocodeH3Response{
				H3:          "",
				Lat:         lat,
				Lng:         lng,
				DisplayName: hit.DisplayName,
			})
			return
		}
		defer engineResp.Body.Close()

		engineBody, err := io.ReadAll(io.LimitReader(engineResp.Body, 1<<16))
		if err != nil || engineResp.StatusCode != http.StatusOK {
			c.JSON(http.StatusOK, GeocodeH3Response{Lat: lat, Lng: lng, DisplayName: hit.DisplayName})
			return
		}

		// Engine returns either an object or an array of hex records.
		// We extract the h3_index from whichever shape it is.
		h3 := extractH3Index(engineBody)

		c.JSON(http.StatusOK, GeocodeH3Response{
			H3:          h3,
			Lat:         lat,
			Lng:         lng,
			DisplayName: hit.DisplayName,
		})
	}
}

// extractH3Index tries to pull "h3_index" from an engine response that may be
// either a single JSON object, an array of objects, or a wrapped {"hexagons":[...]} response.
func extractH3Index(data []byte) string {
	// Try wrapped {"hexagons": [...]} response (most common engine format)
	var wrapped struct {
		Hexagons []map[string]any `json:"hexagons"`
	}
	if err := json.Unmarshal(data, &wrapped); err == nil && len(wrapped.Hexagons) > 0 {
		if v, ok := wrapped.Hexagons[0]["h3_index"].(string); ok && v != "" {
			return v
		}
	}
	// Try bare array
	var arr []map[string]any
	if err := json.Unmarshal(data, &arr); err == nil && len(arr) > 0 {
		if v, ok := arr[0]["h3_index"].(string); ok {
			return v
		}
		if v, ok := arr[0]["id"].(string); ok {
			return v
		}
	}
	// Try single object
	var obj map[string]any
	if err := json.Unmarshal(data, &obj); err == nil {
		if v, ok := obj["h3_index"].(string); ok {
			return v
		}
		if v, ok := obj["id"].(string); ok {
			return v
		}
	}
	return ""
}
