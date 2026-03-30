package enginemgr

import (
	"bufio"
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/eodi-me/api-server/engine"
	"go.uber.org/zap"
)

// Manager handles the lifecycle of the embedded Rust engine process.
//
// Architecture:
//
//	Go App (eodi.exe)
//	  ├── React SPA (embedded)
//	  ├── Engine binary (embedded, extracted to temp)
//	  │     └── AES-256-GCM key (compile-time, decrypts .edb)
//	  └── Proxy: /search, /match, /city/* → engine on 127.0.0.1:{port}
type Manager struct {
	cmd        *exec.Cmd
	port       int
	token      string
	tmpDir     string
	httpClient *http.Client
	logger     *zap.Logger
	mu         sync.RWMutex
	ready      bool
}

// NewManager creates an engine manager.
func NewManager(logger *zap.Logger) *Manager {
	return &Manager{
		httpClient: &http.Client{
			Timeout: 10 * time.Second,
			Transport: &http.Transport{
				MaxIdleConns:       10,
				IdleConnTimeout:    90 * time.Second,
				DisableCompression: true,
				MaxConnsPerHost:    10,
			},
		},
		logger: logger,
	}
}

// Start extracts the engine binary, launches it with the given .edbh path,
// and waits for the ENGINE_READY signal on stdout.
//
// If ENGINE_URL and ENGINE_TOKEN environment variables are set, connects to
// an external engine instance instead of starting an embedded binary.
func (m *Manager) Start(hexdbPath string) error {
	// Support external engine via environment variables (Docker / dev mode)
	if extURL := os.Getenv("ENGINE_URL"); extURL != "" {
		extToken := os.Getenv("ENGINE_TOKEN")
		if extToken == "" {
			extToken = "devtoken"
		}
		// Parse port from URL
		var extPort int
		fmt.Sscanf(extURL, "http://127.0.0.1:%d", &extPort)
		if extPort == 0 {
			fmt.Sscanf(extURL, "http://localhost:%d", &extPort)
		}
		if extPort == 0 {
			// Try generic URL format
			parts := strings.Split(extURL, ":")
			if len(parts) >= 3 {
				fmt.Sscanf(parts[2], "%d", &extPort)
			}
		}
		if extPort == 0 {
			extPort = 7557
		}
		m.mu.Lock()
		m.port = extPort
		m.token = extToken
		m.ready = true
		m.mu.Unlock()
		m.logger.Info("Connected to external engine",
			zap.String("url", extURL),
			zap.Int("port", extPort),
		)
		return nil
	}

	if !engine.HasEmbeddedEngine() {
		return fmt.Errorf("no embedded engine binary")
	}

	// Create isolated temp directory for the engine binary
	tmpDir, err := os.MkdirTemp("", "eodi-engine-*")
	if err != nil {
		return fmt.Errorf("failed to create temp dir: %w", err)
	}
	m.tmpDir = tmpDir

	// Extract engine binary
	enginePath := filepath.Join(tmpDir, "eodi-engine.exe")
	if err := os.WriteFile(enginePath, engine.GetEngineBinary(), 0700); err != nil {
		return fmt.Errorf("failed to extract engine binary: %w", err)
	}

	m.logger.Info("Engine binary extracted",
		zap.String("path", enginePath),
		zap.Int("size_mb", len(engine.GetEngineBinary())/1024/1024),
	)

	// Generate cryptographically random auth token
	tokenBytes := make([]byte, 32)
	if _, err := rand.Read(tokenBytes); err != nil {
		return fmt.Errorf("failed to generate auth token: %w", err)
	}
	m.token = hex.EncodeToString(tokenBytes)

	// Resolve absolute path for the .edbh file
	absHexdbPath, err := filepath.Abs(hexdbPath)
	if err != nil {
		absHexdbPath = hexdbPath
	}

	// Launch engine process
	m.cmd = exec.Command(enginePath, absHexdbPath, m.token)
	m.cmd.Stderr = os.Stderr // engine logs go to parent's stderr
	hideWindow(m.cmd)        // prevent console flash on Windows

	stdout, err := m.cmd.StdoutPipe()
	if err != nil {
		return fmt.Errorf("failed to create stdout pipe: %w", err)
	}

	if err := m.cmd.Start(); err != nil {
		return fmt.Errorf("failed to start engine: %w", err)
	}
	AssignToJob(m.cmd.Process.Pid)

	// Parse port and token from engine's stdout
	// Engine prints: ENGINE_PORT=XXXXX, ENGINE_TOKEN=..., ENGINE_READY
	scanner := bufio.NewScanner(stdout)
	timeout := time.After(30 * time.Second)
	done := make(chan bool)

	go func() {
		var parsedPort int
		for scanner.Scan() {
			line := scanner.Text()
			if strings.HasPrefix(line, "ENGINE_PORT=") {
				fmt.Sscanf(line, "ENGINE_PORT=%d", &parsedPort)
				m.logger.Info("Engine port received", zap.Int("port", parsedPort))
			} else if line == "ENGINE_READY" {
				m.mu.Lock()
				m.port = parsedPort
				m.ready = true
				m.mu.Unlock()
				done <- true
				break
			}
		}
		// Continue draining stdout in background
		go io.Copy(io.Discard, stdout)
	}()

	select {
	case <-done:
		m.logger.Info("Engine started successfully",
			zap.Int("port", m.port),
			zap.String("hexdb", absHexdbPath),
		)
		return nil
	case <-timeout:
		m.cmd.Process.Kill()
		return fmt.Errorf("engine failed to start within 30 seconds")
	}
}

// Stop kills the engine process and cleans up temp files.
func (m *Manager) Stop() {
	m.mu.Lock()
	m.ready = false
	m.mu.Unlock()

	if m.cmd != nil && m.cmd.Process != nil {
		m.logger.Info("Stopping engine process")
		m.cmd.Process.Kill()
		m.cmd.Wait()
		m.cmd = nil
	}

	// Clean up extracted binary
	if m.tmpDir != "" {
		os.RemoveAll(m.tmpDir)
		m.tmpDir = ""
	}
}

// IsReady returns true if the engine is running and ready to serve requests.
func (m *Manager) IsReady() bool {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.ready
}

// Port returns the engine's listening port.
func (m *Manager) Port() int {
	return m.port
}

// Token returns the engine's auth token.
func (m *Manager) Token() string {
	return m.token
}

// BaseURL returns the engine's internal base URL (http://127.0.0.1:PORT).
func (m *Manager) BaseURL() string {
	return fmt.Sprintf("http://127.0.0.1:%d", m.port)
}

// ProxyRequest forwards an HTTP request to the engine with auth token.
func (m *Manager) ProxyRequest(ctx context.Context, method, path, rawQuery string, body io.Reader) (*http.Response, error) {
	if !m.IsReady() {
		return nil, fmt.Errorf("engine not ready")
	}

	url := fmt.Sprintf("%s%s", m.BaseURL(), path)
	if rawQuery != "" {
		url += "?" + rawQuery
	}

	req, err := http.NewRequestWithContext(ctx, method, url, body)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+m.token)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}

	return m.httpClient.Do(req)
}

// HealthCheck performs a health check against the engine.
func (m *Manager) HealthCheck() error {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	resp, err := m.ProxyRequest(ctx, "GET", "/health", "", nil)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("engine health check failed: status %d", resp.StatusCode)
	}
	return nil
}
