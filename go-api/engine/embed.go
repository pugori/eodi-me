// Package engine provides the embedded Rust engine binary.
//
// Build tag: embed_engine (default when eodi-engine.exe exists)
//
// The real binary is embedded via embed_engine.go.
// When building without the engine: go build -tags no_engine
package engine
