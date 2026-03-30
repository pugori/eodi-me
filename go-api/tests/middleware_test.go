package tests

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/eodi-me/api-server/internal/middleware"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
)

func TestRequestID(t *testing.T) {
	gin.SetMode(gin.TestMode)

	r := gin.New()
	r.Use(middleware.RequestID())

	var capturedID string
	r.GET("/test", func(c *gin.Context) {
		capturedID = middleware.GetRequestID(c)
		c.Status(http.StatusOK)
	})

	w := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/test", nil)
	r.ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	assert.NotEmpty(t, capturedID)
	assert.Equal(t, capturedID, w.Header().Get("X-Request-ID"))
}

func TestRateLimit(t *testing.T) {
	gin.SetMode(gin.TestMode)

	r := gin.New()
	r.Use(middleware.RateLimit(2, 2)) // 2 req/sec, burst of 2

	r.GET("/test", func(c *gin.Context) {
		c.Status(http.StatusOK)
	})

	// First request should succeed
	w1 := httptest.NewRecorder()
	req1 := httptest.NewRequest("GET", "/test", nil)
	r.ServeHTTP(w1, req1)
	assert.Equal(t, http.StatusOK, w1.Code)

	// Second request should succeed (within burst)
	w2 := httptest.NewRecorder()
	req2 := httptest.NewRequest("GET", "/test", nil)
	r.ServeHTTP(w2, req2)
	assert.Equal(t, http.StatusOK, w2.Code)

	// Third request should be rate limited
	w3 := httptest.NewRecorder()
	req3 := httptest.NewRequest("GET", "/test", nil)
	r.ServeHTTP(w3, req3)
	assert.Equal(t, http.StatusTooManyRequests, w3.Code)

	// After waiting, should work again
	time.Sleep(600 * time.Millisecond)
	w4 := httptest.NewRecorder()
	req4 := httptest.NewRequest("GET", "/test", nil)
	r.ServeHTTP(w4, req4)
	assert.Equal(t, http.StatusOK, w4.Code)
}

func TestCORS(t *testing.T) {
	gin.SetMode(gin.TestMode)

	// This would require actual config, skipping for now
	t.Skip("CORS middleware requires config setup")
}
