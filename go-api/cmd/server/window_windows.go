package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
	"time"

	"github.com/eodi-me/api-server/internal/enginemgr"
	"github.com/eodi-me/api-server/window"
	"go.uber.org/zap"
)

// launchWindow extracts the embedded window-host binary and opens the WebView2 window.
// When the window is closed by the user, it sends SIGINT to shut down the server.
func launchWindow(serverPort int, logger *zap.Logger, quit chan<- os.Signal) {
	// Wait briefly for the HTTP server to become ready
	time.Sleep(500 * time.Millisecond)

	tmpDir, err := os.MkdirTemp("", "eodi-window-*")
	if err != nil {
		logger.Error("Failed to create temp dir for window host", zap.Error(err))
		return
	}
	defer os.RemoveAll(tmpDir)

	windowPath := filepath.Join(tmpDir, "eodi-window.exe")
	if err := os.WriteFile(windowPath, window.GetWindowBinary(), 0700); err != nil {
		logger.Error("Failed to extract window binary", zap.Error(err))
		return
	}

	url := fmt.Sprintf("http://localhost:%d", serverPort)
	logger.Info("Launching desktop window", zap.String("url", url))

	cmd := exec.Command(windowPath, "--url", url, "--title", "eodi.me")
	cmd.Stderr = os.Stderr
	cmd.SysProcAttr = &syscall.SysProcAttr{
		HideWindow:    true,
		CreationFlags: 0x08000000,
	}

	if err := cmd.Start(); err != nil {
		logger.Error("Failed to start window process", zap.Error(err))
		quit <- syscall.SIGINT
		return
	}
	enginemgr.AssignToJob(cmd.Process.Pid)

	if err := cmd.Wait(); err != nil {
		logger.Error("Window process exited with error", zap.Error(err))
	}

	logger.Info("App window process exited — shutting down server")
	quit <- syscall.SIGINT
}
