package middleware

import (
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/eodi-me/api-server/internal/config"
	"github.com/gin-gonic/gin"
	"golang.org/x/time/rate"
)

// IPRateLimiter maintains a map of rate limiters per IP
type IPRateLimiter struct {
	ips map[string]*rate.Limiter
	mu  *sync.RWMutex
	r   rate.Limit
	b   int
}

// NewIPRateLimiter creates a new IP-based rate limiter
func NewIPRateLimiter(r rate.Limit, b int) *IPRateLimiter {
	return &IPRateLimiter{
		ips: make(map[string]*rate.Limiter),
		mu:  &sync.RWMutex{},
		r:   r,
		b:   b,
	}
}

// GetLimiter returns the rate limiter for the given IP
func (i *IPRateLimiter) GetLimiter(ip string) *rate.Limiter {
	i.mu.Lock()
	defer i.mu.Unlock()

	limiter, exists := i.ips[ip]
	if !exists {
		limiter = rate.NewLimiter(i.r, i.b)
		i.ips[ip] = limiter
	}

	return limiter
}

// CleanupStaleEntries removes limiters that haven't been used recently.
// The goroutine exits naturally when the process exits and the ticker is stopped.
func (i *IPRateLimiter) CleanupStaleEntries() {
	ticker := time.NewTicker(5 * time.Minute)
	defer ticker.Stop()
	for range ticker.C {
		i.mu.Lock()
		i.ips = make(map[string]*rate.Limiter)
		i.mu.Unlock()
	}
}

// RateLimit creates a middleware with explicit rps and burst values.
// This is the low-level variant used in tests; prefer RateLimiter(cfg) in production.
func RateLimit(rps rate.Limit, burst int) gin.HandlerFunc {
	l := NewIPRateLimiter(rps, burst)
	go l.CleanupStaleEntries()
	return func(c *gin.Context) {
		ip := c.ClientIP()
		if !l.GetLimiter(ip).Allow() {
			c.Header("Retry-After", "1")
			c.JSON(http.StatusTooManyRequests, gin.H{"error": "Rate limit exceeded"})
			c.Abort()
			return
		}
		c.Next()
	}
}

var (
	limiter     *IPRateLimiter
	limiterOnce sync.Once
)

// RateLimiter is a middleware that limits requests per IP using app config.
func RateLimiter(cfg *config.Config) gin.HandlerFunc {
	limiterOnce.Do(func() {
		limiter = NewIPRateLimiter(
			rate.Limit(cfg.RateLimitRPS),
			cfg.RateLimitBurst,
		)
		go limiter.CleanupStaleEntries()
	})

	return func(c *gin.Context) {
		ip := c.ClientIP()
		l := limiter.GetLimiter(ip)

		// Always set informational headers so clients can back off gracefully
		limit := int(cfg.RateLimitRPS)
		remaining := int(l.Tokens())
		if remaining < 0 {
			remaining = 0
		}
		c.Header("X-RateLimit-Limit", strconv.Itoa(limit))
		c.Header("X-RateLimit-Remaining", strconv.Itoa(remaining))

		if !l.Allow() {
			c.Header("Retry-After", "1")
			c.Header("X-RateLimit-Remaining", "0")
			c.JSON(http.StatusTooManyRequests, gin.H{
				"error": "Rate limit exceeded",
			})
			c.Abort()
			return
		}

		c.Next()
	}
}
