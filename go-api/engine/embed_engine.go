//go:build !no_engine

package engine

import _ "embed"

// Embed the Rust engine binary (must exist at build time).
// Build script copies target/release/eodi-engine.exe here before Go build.
//
//go:embed eodi-engine.exe
var engineBinary []byte

// HasEmbeddedEngine returns true when the engine binary is embedded.
func HasEmbeddedEngine() bool {
	return len(engineBinary) > 0
}

// GetEngineBinary returns the raw engine executable bytes.
func GetEngineBinary() []byte {
	return engineBinary
}
