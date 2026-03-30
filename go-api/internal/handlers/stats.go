package handlers

import (
	"encoding/json"
	"io"
	"net/http"

	"github.com/eodi-me/api-server/internal/database"
	"github.com/eodi-me/api-server/internal/enginemgr"
	"github.com/gin-gonic/gin"
	"go.uber.org/zap"
)

// Stats handles GET /api/stats — returns data coverage summary.
// Combines city count from the SQLite DB and hex/engine stats from the engine.
func Stats(db *database.DB, mgr *enginemgr.Manager, logger *zap.Logger) gin.HandlerFunc {
	return func(c *gin.Context) {
		resp := gin.H{}

		// City stats from SQLite
		if db != nil {
			if counts, err := db.GetCoverageStats(); err == nil {
				resp["cities"] = counts
			} else {
				logger.Warn("Failed to fetch city coverage stats", zap.Error(err))
				resp["cities"] = nil
			}
		} else {
			resp["cities"] = nil
		}

		// Hex/engine stats — proxy to engine /stats endpoint
		if mgr != nil && mgr.IsReady() {
			engineResp, err := mgr.ProxyRequest(
				c.Request.Context(),
				"GET",
				"/stats",
				"",
				nil,
			)
			if err == nil {
				defer engineResp.Body.Close()
				body, readErr := io.ReadAll(engineResp.Body)
				if readErr == nil {
					var engineData map[string]interface{}
					if json.Unmarshal(body, &engineData) == nil {
						resp["hexagons"] = engineData
					}
				}
			}
		} else {
			resp["hexagons"] = nil
		}

		if resp["cities"] == nil && resp["hexagons"] == nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{
				"error": "No data available — database and engine both offline",
			})
			return
		}

		c.JSON(http.StatusOK, resp)
	}
}
