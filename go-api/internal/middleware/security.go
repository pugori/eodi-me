package middleware

import "github.com/gin-gonic/gin"

// SecurityHeaders adds OWASP-recommended HTTP security headers to every response.
//
// Headers set:
//   - X-Content-Type-Options: nosniff — prevents MIME-type sniffing
//   - X-Frame-Options: DENY — prevents clickjacking
//   - X-XSS-Protection: 1; mode=block — legacy XSS filter for older browsers
//   - Strict-Transport-Security: enforces HTTPS for 1 year including subdomains
//   - Content-Security-Policy: restricts resource origins to same-origin
//   - Referrer-Policy: limits referrer header leakage
//   - Permissions-Policy: disables camera, microphone, geolocation
//   - Cache-Control: prevents API response caching
func SecurityHeaders() gin.HandlerFunc {
	return func(c *gin.Context) {
		h := c.Writer.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("X-Frame-Options", "DENY")
		h.Set("X-XSS-Protection", "1; mode=block")
		h.Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
		h.Set("Content-Security-Policy", "default-src 'self'; script-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; connect-src 'self' https://tiles.openfreemap.org; worker-src 'self' blob:; font-src 'self'; object-src 'none'; frame-ancestors 'none'")
		h.Set("Referrer-Policy", "strict-origin-when-cross-origin")
		h.Set("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
		h.Set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
		c.Next()
	}
}
