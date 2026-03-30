package tests

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/eodi-me/api-server/internal/config"
	"github.com/eodi-me/api-server/internal/database"
	"github.com/eodi-me/api-server/internal/handlers"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"go.uber.org/zap"
)

func setupTestRouter() (*gin.Engine, *database.DB) {
	gin.SetMode(gin.TestMode)

	// Load test config
	cfg, _ := config.Load()
	logger, _ := zap.NewDevelopment()

	// Connect to test database
	db, err := database.NewSQLite(cfg.DBPath)
	if err != nil {
		return nil, nil
	}

	// Create router
	router := gin.New()
	router.GET("/health", handlers.HealthCheck(db, logger))

	// API routes
	api := router.Group("/api")
	{
		cities := api.Group("/cities")
		{
			cities.GET("/search", handlers.SearchCities(db, logger))
			cities.GET("/:city_id", handlers.GetCity(db, logger))
		}
	}

	return router, db
}

func TestHealthCheck(t *testing.T) {
	router, db := setupTestRouter()
	if db == nil {
		t.Skip("SQLite CGO not available in this environment")
	}
	defer db.Close()

	req, _ := http.NewRequest("GET", "/health", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var response map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &response)

	assert.Equal(t, "healthy", response["status"])
	assert.Contains(t, response, "uptime")
}

func TestSearchCities(t *testing.T) {
	router, db := setupTestRouter()
	if db == nil {
		t.Skip("SQLite CGO not available in this environment")
	}
	defer db.Close()

	req, _ := http.NewRequest("GET", "/api/cities/search?q=seoul&limit=10", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var response map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &response)

	cities := response["cities"].([]interface{})
	assert.GreaterOrEqual(t, len(cities), 1)
}

func TestGetCity(t *testing.T) {
	router, db := setupTestRouter()
	if db == nil {
		t.Skip("SQLite CGO not available in this environment")
	}
	defer db.Close()

	// Test valid city ID (Seoul)
	req, _ := http.NewRequest("GET", "/api/cities/1835848", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)

	var city map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &city)

	assert.Equal(t, "1835848", city["id"])
	assert.NotEmpty(t, city["name"])
}

func TestGetCityNotFound(t *testing.T) {
	router, db := setupTestRouter()
	if db == nil {
		t.Skip("SQLite CGO not available in this environment")
	}
	defer db.Close()

	req, _ := http.NewRequest("GET", "/api/cities/invalid-id", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	assert.Equal(t, http.StatusNotFound, w.Code)
}
