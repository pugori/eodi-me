//! AES-256-GCM decryption for .edbh (Encrypted Database Hexagon) files.
//!
//! File format (matches rust-collector's `encrypt_to_file` output):
//! ```text
//! [MAGIC: 4B "EBH2"] [VERSION: 1B] [NONCE: 12B]
//! [PAYLOAD_LEN: 8B LE u64] [CIPHERTEXT: AES-256-GCM]
//! ```
//!
//! The AES-256 key is embedded at compile time — it exists ONLY inside
//! the compiled binary and is never exposed in config, logs, or memory dumps.

use aes_gcm::{aead::Aead, Aes256Gcm, KeyInit, Nonce};
use std::io::{BufReader, Read};
use std::path::Path;

// ─────────────────────────────────────────────────────────────────────────────
// Format constants
// ─────────────────────────────────────────────────────────────────────────────

const EBH_MAGIC: &[u8; 4] = b"EBH2";
const EBH_LEGACY_MAGIC: &[u8; 4] = b"EBH1";
const EDB_VERSION: u8 = 1;
const NONCE_SIZE: usize = 12;

/// AES-256 key embedded at compile time from the secrets/edb.key file.
///
/// The file is gitignored and never enters version control.
/// At compile time the raw bytes are inlined into the binary's read-only data
/// segment — the key is therefore NOT present in any source file or config.
///
/// Both rust-collector (encrypt) and engine-server (decrypt) are compiled
/// against the same key file.
const EDB_KEY: &[u8; 32] = include_bytes!("../../secrets/edb.key");

#[inline(always)]
fn get_edb_key() -> [u8; 32] {
    *EDB_KEY
}

/// Decrypt an `.edbh` file and return the raw plaintext bytes.
///
/// The caller is responsible for deserializing the returned bytes and
/// then calling `zeroize()` on them when done.
pub fn decrypt_edbh_file<P: AsRef<Path>>(path: P) -> anyhow::Result<Vec<u8>> {
    let file = std::fs::File::open(path.as_ref()).map_err(|e| {
        anyhow::anyhow!(
            "Cannot open .edbh file '{}': {}",
            path.as_ref().display(),
            e
        )
    })?;
    // Use a large read buffer (8MB) to reduce syscall overhead for the 518MB file
    let mut file = BufReader::with_capacity(8 * 1024 * 1024, file);

    let mut magic = [0u8; 4];
    file.read_exact(&mut magic)?;
    if &magic != EBH_MAGIC && &magic != EBH_LEGACY_MAGIC {
        anyhow::bail!(
            "Not a valid .edbh file (expected magic {:?} or {:?}, got {:?})",
            EBH_MAGIC,
            EBH_LEGACY_MAGIC,
            magic
        );
    }

    let mut version = [0u8; 1];
    file.read_exact(&mut version)?;
    if version[0] != EDB_VERSION {
        anyhow::bail!(
            "Unsupported .edbh version: {} (expected {})",
            version[0],
            EDB_VERSION
        );
    }

    let mut nonce_bytes = [0u8; NONCE_SIZE];
    file.read_exact(&mut nonce_bytes)?;

    let mut len_bytes = [0u8; 8];
    file.read_exact(&mut len_bytes)?;
    let ciphertext_len = u64::from_le_bytes(len_bytes) as usize;

    let mut ciphertext = vec![0u8; ciphertext_len];
    file.read_exact(&mut ciphertext)?;

    // Reconstruct key
    let key_bytes = get_edb_key();
    let cipher = Aes256Gcm::new(&key_bytes.into());
    let nonce = Nonce::from_slice(&nonce_bytes);
    let plaintext = cipher
        .decrypt(nonce, ciphertext.as_ref())
        .map_err(|_| anyhow::anyhow!("Decryption failed — corrupted .edbh file or key mismatch"))?;

    // Zeroize ciphertext immediately — only plaintext is needed.
    drop(ciphertext);

    Ok(plaintext)
}
