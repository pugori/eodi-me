//go:build !windows

package main

import (
	"os"

	"go.uber.org/zap"
)

// launchWindow is a no-op on non-Windows platforms.
// The desktop window host (WebView2) is Windows-only.
func launchWindow(_ int, logger *zap.Logger, _ chan<- os.Signal) {
	logger.Info("Desktop window not supported on this platform — running as headless server")
}
