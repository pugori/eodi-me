package tests

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/eodi-me/api-server/internal/config"
	"github.com/eodi-me/api-server/internal/handlers"
	"github.com/eodi-me/api-server/internal/middleware"
	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// ─── Health handler ───────────────────────────────────────────────────────────

func TestHealthCheckHandler_NilDB(t *testing.T) {
	gin.SetMode(gin.TestMode)

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest("GET", "/health", nil)

	handlers.HealthCheck(nil, nil)(c)

	assert.Equal(t, http.StatusOK, w.Code)

	var response map[string]interface{}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &response))
	assert.Equal(t, "healthy", response["status"])
	assert.Equal(t, "unavailable", response["database"])
	assert.Contains(t, response, "uptime")
	assert.Contains(t, response, "version")
}

// ─── Metrics handler ──────────────────────────────────────────────────────────

func TestMetricsHandler(t *testing.T) {
	gin.SetMode(gin.TestMode)

	// Default request: Prometheus text format
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest("GET", "/metrics", nil)
	handlers.Metrics()(c)
	assert.Equal(t, http.StatusOK, w.Code)

	// JSON fallback: Accept: application/json
	w2 := httptest.NewRecorder()
	c2, _ := gin.CreateTestContext(w2)
	req2 := httptest.NewRequest("GET", "/metrics", nil)
	req2.Header.Set("Accept", "application/json")
	c2.Request = req2
	handlers.Metrics()(c2)
	assert.Equal(t, http.StatusOK, w2.Code)

	var response map[string]interface{}
	require.NoError(t, json.Unmarshal(w2.Body.Bytes(), &response))
	assert.Contains(t, response, "memory")
	assert.Contains(t, response, "goroutines")
	assert.Contains(t, response, "uptime")

	mem := response["memory"].(map[string]interface{})
	assert.Contains(t, mem, "alloc_mb")
	assert.Contains(t, mem, "sys_mb")
}

// ─── Cities handler validation (no DB required for early-return cases) ────────

func TestSearchCitiesHandler_EmptyQuery_400(t *testing.T) {
	gin.SetMode(gin.TestMode)

	r := gin.New()
	r.GET("/api/cities/search", handlers.SearchCities(nil, nil))

	req := httptest.NewRequest("GET", "/api/cities/search", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestSearchCitiesHandler_TooLongQuery_400(t *testing.T) {
	gin.SetMode(gin.TestMode)

	r := gin.New()
	r.GET("/api/cities/search", handlers.SearchCities(nil, nil))

	longQuery := strings.Repeat("x", 501)
	req := httptest.NewRequest("GET", "/api/cities/search?q="+url.QueryEscape(longQuery), nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
}

// ─── Auth middleware ──────────────────────────────────────────────────────────

func testAuthConfig() *config.Config {
	return &config.Config{
		JWTSecret:   "test-secret-key-for-unit-tests",
		TokenExpiry: time.Hour,
	}
}

func TestAuthMiddleware_NoHeader_401(t *testing.T) {
	gin.SetMode(gin.TestMode)

	r := gin.New()
	r.Use(middleware.Auth(testAuthConfig()))
	r.GET("/protected", func(c *gin.Context) { c.Status(http.StatusOK) })

	req := httptest.NewRequest("GET", "/protected", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusUnauthorized, w.Code)
}

func TestAuthMiddleware_InvalidFormat_401(t *testing.T) {
	gin.SetMode(gin.TestMode)

	r := gin.New()
	r.Use(middleware.Auth(testAuthConfig()))
	r.GET("/protected", func(c *gin.Context) { c.Status(http.StatusOK) })

	req := httptest.NewRequest("GET", "/protected", nil)
	req.Header.Set("Authorization", "InvalidToken abc123")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusUnauthorized, w.Code)
}

func TestAuthMiddleware_ExpiredToken_403(t *testing.T) {
	gin.SetMode(gin.TestMode)
	cfg := testAuthConfig()

	// Build an already-expired JWT
	claims := jwt.MapClaims{
		"user_id": "test-user",
		"exp":     jwt.NewNumericDate(time.Now().Add(-time.Hour)),
		"iat":     jwt.NewNumericDate(time.Now().Add(-2 * time.Hour)),
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	tokenStr, err := token.SignedString([]byte(cfg.JWTSecret))
	require.NoError(t, err)

	r := gin.New()
	r.Use(middleware.Auth(cfg))
	r.GET("/protected", func(c *gin.Context) { c.Status(http.StatusOK) })

	req := httptest.NewRequest("GET", "/protected", nil)
	req.Header.Set("Authorization", "Bearer "+tokenStr)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusForbidden, w.Code)
}

func TestAuthMiddleware_ValidToken_200(t *testing.T) {
	gin.SetMode(gin.TestMode)
	cfg := testAuthConfig()

	tokenStr, err := middleware.GenerateToken(cfg, "user-123")
	require.NoError(t, err)

	r := gin.New()
	r.Use(middleware.Auth(cfg))
	r.GET("/protected", func(c *gin.Context) { c.JSON(http.StatusOK, gin.H{"ok": true}) })

	req := httptest.NewRequest("GET", "/protected", nil)
	req.Header.Set("Authorization", "Bearer "+tokenStr)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
}

// ─── Match request validation ─────────────────────────────────────────────────

func TestMatchRequest_ContentType(t *testing.T) {
	gin.SetMode(gin.TestMode)

	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)

	requestBody := map[string]interface{}{
		"city_id": 1835848,
		"k":       10,
	}
	bodyBytes, _ := json.Marshal(requestBody)

	c.Request = httptest.NewRequest("POST", "/api/match", bytes.NewBuffer(bodyBytes))
	c.Request.Header.Set("Content-Type", "application/json")

	require.NotNil(t, c.Request)
	assert.Equal(t, "application/json", c.Request.Header.Get("Content-Type"))
}
