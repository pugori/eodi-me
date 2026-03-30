//go:build no_engine

package engine

// Stub: no engine binary embedded. Used for development builds
// that don't need the Rust engine (falls back to SQLite).

var engineBinary []byte

// HasEmbeddedEngine returns false — no engine in this build.
func HasEmbeddedEngine() bool {
	return false
}

// GetEngineBinary returns nil — no engine in this build.
func GetEngineBinary() []byte {
	return nil
}
