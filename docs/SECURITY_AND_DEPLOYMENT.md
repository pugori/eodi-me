# Security & Deployment Notes

## Encryption Key Management
The application uses an AES-256-GCM encryption key to secure the `hexagons.edbh` and `cities.edb` databases.

### Key Location
- **Development**: The key is located at `secrets/edb.key`.
- **Production**: The key is **embedded** into the `eodi-collector` and `eodi-engine` binaries at compile time.

### Security Best Practices
1.  **Do not commit `secrets/` to version control.** It is already added to `.gitignore`.
2.  **Backup the key.** If you lose `secrets/edb.key`, you cannot decrypt existing `.edb`/`.edbh` files and must regenerate them using the collector.
3.  **Rotation**: To rotate the key:
    a. Generate a new 32-byte key in `secrets/edb.key`.
    b. Re-run `rust-collector` to regenerate the database files with the new key.
    c. Rebuild `engine-server` (and the main app) to embed the new key.

## Production Build
To build the full application for production:
```powershell
.\build_exe.ps1
```
This script:
1.  Builds the React frontend (Vite).
2.  Builds the Rust engine (Release mode, LTO enabled, Symbols stripped).
3.  Embeds the engine and frontend into the Go binary.
4.  Outputs `eodi.exe` to the `output/` directory.

## Deployment
1.  Copy the contents of `output/` to the target machine.
    - `eodi.exe`
    - `hexagons.edbh`
    - `cities.edb`
2.  Ensure the target machine allows the application to listen on localhost (for the internal engine API).
