//go:build !no_window

package window

import _ "embed"

// Embed the Rust WebView2 window host binary (must exist at build time).
// Build script copies target/release/eodi-window.exe here before Go build.
//
//go:embed eodi-window.exe
var windowBinary []byte

// HasEmbeddedWindow returns true when the window host binary is embedded.
func HasEmbeddedWindow() bool {
	return len(windowBinary) > 0
}

// GetWindowBinary returns the raw window host executable bytes.
func GetWindowBinary() []byte {
	return windowBinary
}
