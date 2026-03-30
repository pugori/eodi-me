package handlers

import (
	"fmt"
	"net/http"
	"strings"

	"github.com/eodi-me/api-server/internal/database"
	"github.com/eodi-me/api-server/internal/models"
	"github.com/eodi-me/api-server/internal/utils"
	"github.com/gin-gonic/gin"
	"go.uber.org/zap"
)

// FindMatches handles POST /api/match
func FindMatches(db *database.DB, logger *zap.Logger) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req models.MatchRequest

		// Bind JSON request
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body"})
			return
		}

		// Set default k
		if req.K == 0 {
			req.K = 10
		}
		// Cap k at maximum to prevent excessive memory use
		if req.K > 100 {
			req.K = 100
			c.Header("X-Result-Capped", "true")
		}

		// Get query vector
		var queryVector []float32
		var queryCityName *string

		if req.Vector != nil && len(req.Vector) > 0 {
			// Direct vector provided — must match the 13-dimensional vibe model
			// (dims 0-5 Urban Vibe/POI, 6-7 POI profile, 8 water, 9 temporal,
			//  10 flow, 11 population density, 12 transit — climate dims removed)
			const vibeVectorDim = 13
			if len(req.Vector) != vibeVectorDim {
				c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("Vector must be %d-dimensional", vibeVectorDim)})
				return
			}
			queryVector = req.Vector

		} else if req.CityID != nil {
			// Get vector by city ID
			vector, err := db.GetCityVector(*req.CityID)
			if err != nil {
				if err.Error() == "vector not found" {
					c.JSON(http.StatusNotFound, gin.H{"error": "City vector not found"})
					return
				}
				logger.Error("Failed to get city vector",
					zap.Error(err),
					zap.String("city_id", *req.CityID),
				)
				c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get city vector"})
				return
			}
			queryVector = vector

			// Get city name
			city, err := db.GetCity(*req.CityID)
			if err == nil {
				queryCityName = &city.Name
			}

		} else if req.CityName != nil {
			// Search city by name first
			cities, err := db.SearchCities(strings.ToLower(*req.CityName), 1, nil)
			if err != nil || len(cities) == 0 {
				c.JSON(http.StatusNotFound, gin.H{"error": "City not found"})
				return
			}

			cityID := cities[0].ID
			queryCityName = &cities[0].Name

			// Get vector
			vector, err := db.GetCityVector(cityID)
			if err != nil {
				c.JSON(http.StatusNotFound, gin.H{"error": "City vector not found"})
				return
			}
			queryVector = vector

		} else {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Must provide city_id, city_name, or vector"})
			return
		}

		// Get all vectors for matching (fallback to numpy-style search)
		cityIDs, vectors, err := db.GetAllVectors()
		if err != nil {
			logger.Error("Failed to get vectors", zap.Error(err))
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get vectors"})
			return
		}

		// Calculate distances
		distances := make([]float64, len(vectors))
		for i, vec := range vectors {
			if d, ok := utils.L2DistanceSquared(queryVector, vec); ok {
				distances[i] = d
			} else {
				distances[i] = 1e9 // treat dimension mismatch as maximum distance
			}
		}

		// Find top-k indices
		topK := utils.FindTopK(distances, req.K)

		// Get sigma squared
		sigmaSquared, err := db.GetSigmaSquared()
		if err != nil {
			// Fallback: estimate from distances
			sigmaSquared = utils.EstimateSigmaSquared(distances)
		}

		// Build results
		results := make([]models.MatchResult, 0, len(topK))
		for _, idx := range topK {
			cityID := cityIDs[idx]
			distSq := distances[idx]

			// Get city info
			city, err := db.GetCity(cityID)
			if err != nil {
				logger.Warn("Skipping city in match results",
					zap.String("city_id", cityID),
					zap.Error(err),
				)
				continue
			}

			// Calculate similarity
			similarity := utils.GaussianRBFSimilarity(distSq, sigmaSquared)

			result := models.MatchResult{
				CityID:     cityID,
				Name:       city.Name,
				Similarity: similarity,
				Distance:   distSq,
				Country:    city.Country,
				Population: city.Population,
			}

			// Optionally add radar chart
			if vector, err := db.GetCityVector(cityID); err == nil {
				result.Radar = utils.VectorToRadar(vector)
			}

			results = append(results, result)
		}

		// Build response
		response := models.MatchResponse{
			QueryCity:    queryCityName,
			Results:      results,
			SigmaSquared: sigmaSquared,
		}

		c.JSON(http.StatusOK, response)
	}
}
