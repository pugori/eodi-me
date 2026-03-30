package config

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/joho/godotenv"
)

// knownWeakSecrets lists default/example secrets that must be replaced in production.
var knownWeakSecrets = []string{
	"change-me-in-production",
	"changeme",
	"secret",
	"",
}

type Config struct {
	// Server
	ServerHost string
	ServerPort int
	GinMode    string

	// Database
	DBPath string

	// Engine
	HexDBPath string // path to hexagons.edbh VDB

	// Auth
	JWTSecret   string
	TokenExpiry time.Duration

	// Rate Limiting
	RateLimitRPS   int
	RateLimitBurst int

	// Redis (optional)
	RedisAddr     string
	RedisPassword string
	RedisDB       int

	// Logging
	LogLevel  string
	LogFormat string

	// CORS
	AllowOrigins []string
}

func Load() (*Config, error) {
	// Load .env file (ignore error if not exists)
	godotenv.Load()

	// Resolve paths relative to the executable location for portable deployment
	exeDir := "."
	if ep, err := os.Executable(); err == nil {
		exeDir = filepath.Dir(ep)
	}

	cfg := &Config{
		ServerHost: getEnv("SERVER_HOST", "0.0.0.0"),
		ServerPort: getEnvInt("SERVER_PORT", 8000),
		GinMode:    getEnv("GIN_MODE", "debug"),

		DBPath: getEnv("DB_PATH", resolveDataPath(exeDir, "cities.edb", "data/vibe_data.db")),

		HexDBPath: getEnv("HEX_DB_PATH", resolveDataPath(exeDir, "hexagons.edbh", "data/hexagons.edbh")),

		JWTSecret:   getEnv("JWT_SECRET", "change-me-in-production"),
		TokenExpiry: getEnvDuration("TOKEN_EXPIRY", 24*time.Hour),

		RateLimitRPS:   getEnvInt("RATE_LIMIT_RPS", 100),
		RateLimitBurst: getEnvInt("RATE_LIMIT_BURST", 200),

		RedisAddr:     getEnv("REDIS_ADDR", ""),
		RedisPassword: getEnv("REDIS_PASSWORD", ""),
		RedisDB:       getEnvInt("REDIS_DB", 0),

		LogLevel:  getEnv("LOG_LEVEL", "info"),
		LogFormat: getEnv("LOG_FORMAT", "json"),

		AllowOrigins: []string{
			getEnv("ALLOW_ORIGIN", ""),
		},
	}

	return cfg, cfg.validate()
}

// resolveDataPath checks if a file exists next to the executable; falls back to the default path.
func resolveDataPath(exeDir, filename, fallback string) string {
	beside := filepath.Join(exeDir, filename)
	if _, err := os.Stat(beside); err == nil {
		return beside
	}
	return fallback
}

// validate enforces production-safe configuration.
func (c *Config) validate() error {
	// Desktop mode: auto-generate a secure JWT secret if default is used.
	// The standalone exe runs locally — JWT is only used for internal auth.
	isWeakSecret := false
	for _, weak := range knownWeakSecrets {
		if c.JWTSecret == weak {
			isWeakSecret = true
			break
		}
	}
	if isWeakSecret || len(c.JWTSecret) < 32 ||
		strings.Contains(strings.ToLower(c.JWTSecret), "change") ||
		strings.Contains(strings.ToLower(c.JWTSecret), "secret") ||
		strings.Contains(strings.ToLower(c.JWTSecret), "default") {
		// Desktop mode: try to load persisted secret first for session continuity
		secretFile := filepath.Join(filepath.Dir(c.DBPath), ".jwt_secret")
		if data, err := os.ReadFile(secretFile); err == nil && len(data) >= 64 {
			c.JWTSecret = strings.TrimSpace(string(data))
			log.Println("INFO: JWT_SECRET loaded from persisted file")
		} else {
			// Auto-generate and persist for future restarts
			b := make([]byte, 32)
			if _, err := rand.Read(b); err != nil {
				return errors.New("failed to auto-generate JWT_SECRET")
			}
			c.JWTSecret = hex.EncodeToString(b)
			_ = os.WriteFile(secretFile, []byte(c.JWTSecret), 0600)
			log.Println("INFO: JWT_SECRET auto-generated and persisted (desktop mode)")
		}
	}
	// Port range: 1–65535, avoid privileged ports below 1024 in production
	if c.ServerPort < 1 || c.ServerPort > 65535 {
		return fmt.Errorf("SERVER_PORT %d is out of range (1–65535)", c.ServerPort)
	}
	if c.GinMode == "release" && c.ServerPort < 1024 {
		return fmt.Errorf("SERVER_PORT %d is a privileged port (<1024) — use 8080 or higher in production", c.ServerPort)
	}
	// Rate limit must be positive
	if c.RateLimitRPS <= 0 {
		return errors.New("RATE_LIMIT_RPS must be greater than 0")
	}
	// Warn if CORS is wildcard or empty in release mode
	if c.GinMode == "release" {
		for _, origin := range c.AllowOrigins {
			if origin == "*" || origin == "" {
				return errors.New("ALLOW_ORIGIN must be explicitly set in release mode (not wildcard or empty)")
			}
		}
	}
	return nil
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

func getEnvInt(key string, defaultValue int) int {
	if value := os.Getenv(key); value != "" {
		if intValue, err := strconv.Atoi(value); err == nil {
			return intValue
		}
		log.Printf("WARN: env %s=%q is not a valid integer, using default %d", key, value, defaultValue)
	}
	return defaultValue
}

func getEnvDuration(key string, defaultValue time.Duration) time.Duration {
	if value := os.Getenv(key); value != "" {
		if duration, err := time.ParseDuration(value); err == nil {
			return duration
		}
		log.Printf("WARN: env %s=%q is not a valid duration, using default %s", key, value, defaultValue)
	}
	return defaultValue
}
