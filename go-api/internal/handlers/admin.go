package handlers

import (
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"go.uber.org/zap"
)

// Me handles GET /api/me — returns info about the current authenticated token.
func Me(logger *zap.Logger) gin.HandlerFunc {
	return func(c *gin.Context) {
		authHeader := c.GetHeader("Authorization")
		tokenString := strings.TrimPrefix(authHeader, "Bearer ")

		// Parse claims without re-validating signature (already validated by Auth middleware)
		claims := jwt.MapClaims{}
		_, _, err := jwt.NewParser().ParseUnverified(tokenString, claims)
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Unable to parse token"})
			return
		}

		userID, _ := claims["user_id"].(string)

		resp := gin.H{
			"user_id":    userID,
			"token_type": "Bearer",
			"server_time": time.Now().UTC().Format(time.RFC3339),
		}
		if exp, ok := claims["exp"]; ok {
			resp["exp"] = exp
		}

		c.JSON(http.StatusOK, resp)
	}
}
