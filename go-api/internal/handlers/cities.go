package handlers

import (
	"net/http"
	"strings"

	"github.com/eodi-me/api-server/internal/database"
	"github.com/eodi-me/api-server/internal/models"
	"github.com/eodi-me/api-server/internal/utils"
	"github.com/gin-gonic/gin"
	"go.uber.org/zap"
)

// SearchCities handles GET /api/cities/search
func SearchCities(db *database.DB, logger *zap.Logger) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req models.CitiesSearchRequest

		// Bind query parameters
		if err := c.ShouldBindQuery(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request parameters"})
			return
		}

		// Reject excessively long queries
		if len(req.Query) > 500 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Query too long (max 500 characters)"})
			return
		}

		// Set default limit
		if req.Limit == 0 {
			req.Limit = 20
		}
		if req.Limit > 200 {
			req.Limit = 200
		}

		// Search cities
		cities, err := db.SearchCities(strings.ToLower(req.Query), req.Limit, req.Country)
		if err != nil {
			logger.Error("Failed to search cities",
				zap.Error(err),
				zap.String("query", req.Query),
			)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to search cities"})
			return
		}

		c.JSON(http.StatusOK, models.CitiesSearchResponse{
			Cities: cities,
		})
	}
}

// GetCity handles GET /api/cities/:city_id
func GetCity(db *database.DB, logger *zap.Logger) gin.HandlerFunc {
	return func(c *gin.Context) {
		cityID := c.Param("city_id")
		includeVector := c.Query("include_vector") == "true"
		includeRadar := c.Query("include_radar") == "true"

		// Get basic city info
		city, err := db.GetCity(cityID)
		if err != nil {
			if err.Error() == "city not found" {
				c.JSON(http.StatusNotFound, gin.H{"error": "City not found"})
				return
			}
			logger.Error("Failed to get city",
				zap.Error(err),
				zap.String("city_id", cityID),
			)
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get city"})
			return
		}

		// Create detail response
		detail := models.CityDetail{
			City: *city,
		}

		// Optionally include vector and radar
		if includeVector || includeRadar {
			vector, err := db.GetCityVector(cityID)
			if err == nil {
				if includeVector {
					detail.Vector = vector
				}
				if includeRadar {
					detail.Radar = utils.VectorToRadar(vector)
				}
			}
		}

		c.JSON(http.StatusOK, detail)
	}
}
