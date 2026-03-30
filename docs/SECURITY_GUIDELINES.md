# Secure Engine Architecture & Key Management Guidelines

## 1. Security Philosophy
The City Vibe Engine is a standalone, local-first application. To protect the proprietary data and algorithms, we employ a multi-layered security approach focusing on binary protection and data encryption.

## 2. Key Management (Development vs. Production)

### Development Environment (Secure Key Externalization)
- **Key Location**: `secrets/edb.key` (32-byte binary).
- **Protection**: This file is **gitignored**. It never leaves the developer's local machine or secure build server.
- **Generation**: Created via `[System.Security.Cryptography.RandomNumberGenerator]` PowerShell command.

### Production Environment (Runtime Obfuscation)
- **Goal**: Prevent static analysis and simple string extraction from the compiled binary.
- **Method**: The 32-byte key is **fragmented** and **XOR-masked** at compile time.
- **Implementation**:
    1. The build script/process breaks the 32-byte key into 4 chunks (8 bytes each).
    2. Random 8-byte masks are generated for each chunk.
    3. The key chunks are XORed with their masks.
    4. These masked chunks and the masks themselves are hardcoded into `engine-server/src/crypto.rs` as byte arrays.
    5. At **runtime**, the `get_edb_key()` function reconstructs the original key in memory only when needed for decryption.
- **Result**: The original key never appears as a contiguous 32-byte block in the `eodi.exe` binary.

## 3. Communication Architecture (Internal API)

### Localhost Isolation
- **Binding**: The Rust Engine (`eodi-engine.exe`) binds exclusively to `127.0.0.1`.
- **Port**: Randomly assigned or fixed internal port, not exposed to the LAN/WAN.
- **Transport**: Standard HTTP/JSON, but strictly loopback.

### Application Integration
- **Structure**:
    - `eodi.exe` (Go Wrapper / Main Process)
        - Spawns `eodi-engine.exe` (Child Process, Hidden)
        - Serves React Frontend (WebView2)
- **Flow**:
    `Frontend (React)` -> `Go Proxy (Internal)` -> `Rust Engine (Hidden)`
- **Authentication**:
    - The Engine generates a random **Session Token** on startup.
    - This token is passed to the Go parent process via stdout/pipe.
    - All requests from the internal Go proxy to the Engine must include this token.
    - This prevents other local user processes from querying the engine.

## 4. Build & Deployment Checklist

1. [ ] **Key Rotation**: Before major releases, generate a new key in `secrets/edb.key` and re-run the collector to re-encrypt all `.edb` databases.
2. [ ] **Obfuscation Update**: Update the hardcoded masked chunks in `crypto.rs` using the `scripts/generate_obfuscated_key.py` script.
3. [ ] **Release Build**: Always build with `--release` format to strip debug symbols and enable optimizations (LTO), making reverse engineering harder.
4. [ ] **Verification**: Use a hex editor to verify the raw key bytes are NOT present in the final `.exe`.

---
**Maintained by:** Security Team
**Last Updated:** 2026-02-24
