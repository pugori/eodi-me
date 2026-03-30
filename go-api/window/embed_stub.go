//go:build no_window

package window

// Stub: no window host binary embedded. Used for development builds
// that don't need the embedded WebView2 window (falls back to Edge --app).

var windowBinary []byte

// HasEmbeddedWindow returns false — no window host in this build.
func HasEmbeddedWindow() bool {
	return false
}

// GetWindowBinary returns nil — no window host in this build.
func GetWindowBinary() []byte {
	return nil
}
