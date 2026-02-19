"use client";

/**
 * 🔐 DIGITAL SHREDDER - Cryptographic Core
 * Implementation level: Senior Security Engineer
 * 
 * Features:
 * - ECDH (X9.62 P-384) for Perfect Forward Secrecy-like key exchange.
 * - AES-GCM (256-bit) for Authenticated Encryption with Associated Data (AEAD).
 * - Automatic buffer zeroing (wipeBytes) for anti-forensic memory safety.
 * - No persistent keys; all keys are ephemeral and session-scoped.
 */

export const TE = new TextEncoder();
export const TD = new TextDecoder();
const AES_GCM_CHUNK_SIZE = 16384; // 16KB for streaming if needed

/**
 * Ensures memory is overwritten before allowing GC to collect.
 */
export function wipe(buf: Uint8Array | null | undefined) {
    if (buf) buf.fill(0);
}

/**
 * Securely generate an ephemeral ECDH keypair for the session.
 */
export async function generateSessionKeyPair(): Promise<CryptoKeyPair> {
    return await crypto.subtle.generateKey(
        { name: "ECDH", namedCurve: "P-384" },
        false, // Not extractable (remains in secure memory area if possible)
        ["deriveKey", "deriveBits"]
    );
}

/**
 * Derive a shared AES-256-GCM key from local private key and remote public key.
 */
export async function deriveSharedKey(localPrivate: CryptoKey, remotePublic: CryptoKey): Promise<CryptoKey> {
    return await crypto.subtle.deriveKey(
        { name: "ECDH", public: remotePublic },
        localPrivate,
        { name: "AES-GCM", length: 256 },
        false, // Secret key is never extractable
        ["encrypt", "decrypt"]
    );
}

/**
 * Export a public key to a format suitable for signaling (JWK or raw).
 */
export async function exportPublicKey(key: CryptoKey): Promise<JsonWebKey> {
    return await crypto.subtle.exportKey("jwk", key);
}

/**
 * Import a remote public key from JWK.
 */
export async function importPublicKey(jwk: JsonWebKey): Promise<CryptoKey> {
    return await crypto.subtle.importKey(
        "jwk",
        jwk,
        { name: "ECDH", namedCurve: "P-384" },
        true,
        []
    );
}

/**
 * Identity = SHA-256 Fingerprint of the Public Key (Base64URL)
 */
export async function getIdentityFingerprint(publicKey: CryptoKey): Promise<string> {
    const exported = await crypto.subtle.exportKey("spki", publicKey);
    const hash = await crypto.subtle.digest("SHA-256", exported);
    const fingerprint = b64urlEncode(hash);
    // Zero out the temporary exported buffer
    wipe(new Uint8Array(exported));
    return fingerprint;
}

/**
 * AES-GCM Encryption with Metadata Camouflage (Padding)
 */
export async function encrypt(key: CryptoKey, plaintext: string, aad: string): Promise<Uint8Array> {
    const ptBytes = TE.encode(plaintext);

    // 🛡️ Metadata Camouflage: Normalize message size to 4KB chunks
    // This prevents traffic analysis based on message length.
    const paddedSize = Math.ceil((ptBytes.length + 4) / 4096) * 4096;
    const paddedPt = new Uint8Array(paddedSize);
    const dv = new DataView(paddedPt.buffer);
    dv.setUint32(0, ptBytes.length); // Store actual length
    paddedPt.set(ptBytes, 4);
    // Remaining space stays random or zeroed (using zeroed here for simplicity, random preferred for high-sec)

    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv, additionalData: TE.encode(aad) },
        key,
        paddedPt
    );

    const out = new Uint8Array(iv.length + ct.byteLength);
    out.set(iv, 0);
    out.set(new Uint8Array(ct), iv.length);

    // Wipe temporary buffers
    wipe(ptBytes);
    wipe(paddedPt);

    return out;
}

/**
 * AES-GCM Decryption
 */
export async function decrypt(key: CryptoKey, bundle: Uint8Array, aad: string): Promise<string | null> {
    try {
        const iv = bundle.slice(0, 12);
        const ct = bundle.slice(12);
        const paddedPt = await crypto.subtle.decrypt(
            { name: "AES-GCM", iv, additionalData: TE.encode(aad) },
            key,
            ct
        );

        const ptArray = new Uint8Array(paddedPt);
        const dv = new DataView(ptArray.buffer);
        const originalLen = dv.getUint32(0);
        const pt = ptArray.slice(4, 4 + originalLen);

        const result = TD.decode(pt);

        // Wipe sensitive data
        wipe(ptArray);
        wipe(new Uint8Array(paddedPt));

        return result;
    } catch (e) {
        console.error("Decryption failed:", e);
        return null;
    }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

export function b64urlEncode(buf: ArrayBufferLike): string {
    const b = new Uint8Array(buf);
    let binary = "";
    for (let i = 0; i < b.byteLength; i++) {
        binary += String.fromCharCode(b[i]!);
    }
    return btoa(binary)
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/g, "");
}

export function b64urlDecode(s: string): Uint8Array {
    const padLen = (4 - (s.length % 4)) % 4;
    const base64 = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat(padLen);
    const binary = atob(base64);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        out[i] = binary.charCodeAt(i)!;
    }
    return out;
}
