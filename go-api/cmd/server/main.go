package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/eodi-me/api-server/internal/config"
	"github.com/eodi-me/api-server/internal/database"
	"github.com/eodi-me/api-server/internal/enginemgr"
	"github.com/eodi-me/api-server/internal/handlers"
	"github.com/eodi-me/api-server/internal/router"
	"github.com/eodi-me/api-server/window"
	"go.uber.org/zap"
)

// Version is set at build time via -ldflags "-X main.Version=x.y.z".
// Falls back to "dev" when built without version flags (local development).
var Version = "dev"

func main() {
	// Load configuration
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("Failed to load configuration: %v", err)
	}

	// Initialize logger
	logger, err := initLogger(cfg)
	if err != nil {
		log.Fatalf("Failed to initialize logger: %v", err)
	}
	defer logger.Sync()

	logger.Info("Starting EODI.ME API Server",
		zap.String("version", Version),
		zap.String("environment", cfg.GinMode),
	)

	// Initialize database (optional — city search unavailable without it)
	db, err := database.NewSQLite(cfg.DBPath)
	if err != nil {
		logger.Warn("Database not available — city search disabled",
			zap.Error(err),
			zap.String("path", cfg.DBPath),
		)
		db = nil
	} else {
		logger.Info("Database connected", zap.String("path", cfg.DBPath))
	}
	defer func() {
		if db != nil {
			db.Close()
		}
	}()

	// Propagate build version to health handler
	handlers.AppVersion = Version

	// Initialize engine manager (optional — degrades gracefully if no binary)
	mgr := enginemgr.NewManager(logger)
	defer mgr.Stop() // Always clean up engine process/temp files, even on failed start
	if err := mgr.Start(cfg.HexDBPath); err != nil {
		logger.Warn("Engine not started — hexagon endpoints will be unavailable",
			zap.Error(err),
			zap.String("hex_db", cfg.HexDBPath),
		)
	} else {
		logger.Info("Engine started", zap.Int("port", mgr.Port()))
	}

	// Setup router with all routes and middleware
	r := router.SetupRouter(cfg, db, mgr, logger)

	// Create HTTP server
	srv := &http.Server{
		Addr:           fmt.Sprintf("%s:%d", cfg.ServerHost, cfg.ServerPort),
		Handler:        r,
		ReadTimeout:    10 * time.Second,
		WriteTimeout:   10 * time.Second,
		MaxHeaderBytes: 1 << 20, // 1 MB
	}

	// Start server in goroutine
	go func() {
		logger.Info("Server starting",
			zap.String("address", srv.Addr),
		)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Fatal("Server failed to start", zap.Error(err))
		}
	}()

	// Launch window host (if embedded) — opens the desktop app UI
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)

	if window.HasEmbeddedWindow() {
		go launchWindow(cfg.ServerPort, logger, quit)
	}

	// Wait for interrupt signal (or window close)
	<-quit

	logger.Info("Server shutting down...")

	// Graceful shutdown with 5 second timeout
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := srv.Shutdown(ctx); err != nil {
		logger.Error("Server forced to shutdown", zap.Error(err))
	}

	logger.Info("Server stopped")
}

func initLogger(cfg *config.Config) (*zap.Logger, error) {
	var zapCfg zap.Config
	if cfg.GinMode == "release" {
		zapCfg = zap.NewProductionConfig()
	} else {
		zapCfg = zap.NewDevelopmentConfig()
	}

	// Log to file alongside the executable
	exePath, _ := os.Executable()
	logPath := filepath.Join(filepath.Dir(exePath), "eodi.log")
	zapCfg.OutputPaths = []string{logPath}
	zapCfg.ErrorOutputPaths = []string{logPath, "stderr"}

	return zapCfg.Build()
}
