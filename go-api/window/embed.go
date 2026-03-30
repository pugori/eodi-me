// Package window provides the embedded WebView2 window host binary.
//
// Build tag: no_window (opt-out when building without the window binary)
//
// The real binary is embedded via embed_window.go.
// When building without the window host: go build -tags no_window
package window
