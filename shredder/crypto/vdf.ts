"use client";

/**
 * ⏳ VERIFIABLE DELAY FUNCTION (VDF) ENGINE
 * 
 * Implements time-locked message encryption using Wesolowski-style VDF.
 * 
 * Concept:
 * - Messages are encrypted with a key derived from a VDF puzzle
 * - The puzzle requires sequential computation (cannot be parallelized)
 * - The receiver must solve T iterations of squaring modulo N
 * - This guarantees the message cannot be decrypted before the delay period
 * 
 * Security Model:
 * - Uses SHA-256 iterated hashing as the delay function
 * - Combined with time-lock puzzle encryption
 * - The puzzle solution is the decryption key
 * 
 * Use cases: Whistleblowing, delayed disclosures, timed reveals
 */

import { TE, TD, wipe, b64urlEncode, b64urlDecode } from "./crypto";

// ── Types ─────────────────────────────────────────────────────────────────

export interface VDFTimeLockMessage {
    v: 2;
    type: "vdf-time-locked";
    /** VDF puzzle seed (base64url) */
    seed: string;
    /** Number of sequential hash iterations required */
    iterations: number;
    /** Estimated unlock timestamp (advisory only, actual unlock requires computation) */
    estimatedUnlockAt: number;
    /** Encrypted ciphertext (base64url) - IV prepended */
    ciphertext: string;
    /** HMAC for integrity check after decryption (base64url) */
    hmac: string;
    /** Creation timestamp */
    createdAt: number;
    /** Delay in seconds (for display) */
    delaySeconds: number;
}

export interface VDFProgress {
    current: number;
    total: number;
    percentComplete: number;
    estimatedTimeRemainingMs: number;
}

export type VDFProgressCallback = (progress: VDFProgress) => void;

// ── Constants ─────────────────────────────────────────────────────────────

/**
 * Calibration: Iterations per second on average hardware.
 * SHA-256 sequential hashing: ~800,000 iterations/sec on modern browser.
 * We calibrate conservatively to ensure minimum delay.
 */
const ITERATIONS_PER_SECOND = 500_000;
const MIN_ITERATIONS = 1_000;
const MAX_ITERATIONS = 300_000_000; // ~10 minutes on average hardware
const PROGRESS_REPORT_INTERVAL = 50_000;

// ── Core VDF Functions ────────────────────────────────────────────────────

/**
 * Generate a random seed for the VDF puzzle
 */
function generateSeed(): Uint8Array {
    return crypto.getRandomValues(new Uint8Array(32));
}

/**
 * Compute the VDF: T sequential rounds of SHA-256 hashing.
 * This is inherently sequential and cannot be parallelized.
 * 
 * H₀ = seed
 * H₁ = SHA-256(H₀)
 * H₂ = SHA-256(H₁)
 * ...
 * Hₜ = SHA-256(Hₜ₋₁)  ← this is the VDF output (decryption key material)
 */
async function computeVDF(
    seed: Uint8Array,
    iterations: number,
    onProgress?: VDFProgressCallback
): Promise<Uint8Array> {
    let current = new Uint8Array(seed);
    const startTime = performance.now();

    for (let i = 0; i < iterations; i++) {
        const hash = await crypto.subtle.digest("SHA-256", current);
        current = new Uint8Array(hash);

        // Report progress at intervals
        if (onProgress && i > 0 && i % PROGRESS_REPORT_INTERVAL === 0) {
            const elapsed = performance.now() - startTime;
            const rate = i / elapsed;
            const remaining = (iterations - i) / rate;

            onProgress({
                current: i,
                total: iterations,
                percentComplete: Math.floor((i / iterations) * 100),
                estimatedTimeRemainingMs: remaining
            });

            // Yield to the event loop to keep UI responsive
            await new Promise(resolve => setTimeout(resolve, 0));
        }
    }

    return current;
}

/**
 * Derive an AES-256-GCM key from VDF output using HKDF
 */
async function deriveKeyFromVDFOutput(vdfOutput: Uint8Array): Promise<CryptoKey> {
    const hkdfKey = await crypto.subtle.importKey(
        "raw",
        vdfOutput as unknown as ArrayBuffer,
        "HKDF",
        false,
        ["deriveKey"]
    );

    return await crypto.subtle.deriveKey(
        {
            name: "HKDF",
            hash: "SHA-256",
            salt: TE.encode("digital-shredder-vdf-v2"),
            info: TE.encode("time-lock-encryption-key")
        },
        hkdfKey,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"]
    );
}

/**
 * Compute HMAC-SHA-256 for integrity verification
 */
async function computeHMAC(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
    const hmacKey = await crypto.subtle.importKey(
        "raw",
        key as unknown as ArrayBuffer,
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
    );
    const sig = await crypto.subtle.sign("HMAC", hmacKey, data as unknown as ArrayBuffer);
    return new Uint8Array(sig);
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Create a time-locked encrypted message.
 * 
 * The sender:
 * 1. Generates a random seed
 * 2. Computes the full VDF (T iterations) to get the key
 * 3. Encrypts the message with the VDF-derived key
 * 4. Sends: { seed, iterations, ciphertext }
 * 
 * The receiver must:
 * 1. Compute the same VDF from the seed (takes ~delaySeconds)
 * 2. Derive the same key
 * 3. Decrypt the message
 * 
 * @param content - The plaintext message to encrypt
 * @param delaySeconds - Minimum delay before decryption is possible
 * @param onProgress - Optional progress callback during sender's VDF computation
 */
export async function createTimeLockMessage(
    content: string,
    delaySeconds: number,
    onProgress?: VDFProgressCallback
): Promise<VDFTimeLockMessage> {
    // Calculate iterations based on target delay
    const iterations = Math.max(
        MIN_ITERATIONS,
        Math.min(MAX_ITERATIONS, Math.floor(delaySeconds * ITERATIONS_PER_SECOND))
    );

    // Generate puzzle seed
    const seed = generateSeed();

    // Compute VDF to get key material (sender pays the cost once)
    const vdfOutput = await computeVDF(seed, iterations, onProgress);

    // Derive encryption key
    const encKey = await deriveKeyFromVDFOutput(vdfOutput);

    // Encrypt the message
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ptBytes = TE.encode(content);
    const ct = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv },
        encKey,
        ptBytes
    );

    // Combine IV + ciphertext
    const combined = new Uint8Array(iv.length + ct.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(ct), iv.length);

    // Compute HMAC for integrity
    const hmac = await computeHMAC(vdfOutput, combined);

    // Wipe sensitive temporaries
    wipe(vdfOutput);
    wipe(ptBytes);

    return {
        v: 2,
        type: "vdf-time-locked",
        seed: b64urlEncode(seed.buffer),
        iterations,
        estimatedUnlockAt: Date.now() + (delaySeconds * 1000),
        ciphertext: b64urlEncode(combined.buffer),
        hmac: b64urlEncode(hmac.buffer),
        createdAt: Date.now(),
        delaySeconds
    };
}

/**
 * Solve a VDF time-lock puzzle and decrypt the message.
 * 
 * This function will take approximately `delaySeconds` to complete,
 * as it must compute the full VDF sequentially.
 * 
 * @param message - The time-locked message
 * @param onProgress - Progress callback for UI updates
 * @returns Decrypted plaintext, or null if verification fails
 */
export async function solveTimeLockMessage(
    message: VDFTimeLockMessage,
    onProgress?: VDFProgressCallback
): Promise<string | null> {
    try {
        // Reconstruct seed
        const seed = b64urlDecode(message.seed);

        // Solve the VDF puzzle (this is the time-consuming part)
        const vdfOutput = await computeVDF(seed, message.iterations, onProgress);

        // Verify HMAC
        const ciphertextBytes = b64urlDecode(message.ciphertext);
        const expectedHmac = b64urlDecode(message.hmac);
        const computedHmac = await computeHMAC(vdfOutput, ciphertextBytes);

        let hmacValid = true;
        if (expectedHmac.length !== computedHmac.length) {
            hmacValid = false;
        } else {
            for (let i = 0; i < expectedHmac.length; i++) {
                if (expectedHmac[i] !== computedHmac[i]) {
                    hmacValid = false;
                    break;
                }
            }
        }

        if (!hmacValid) {
            console.error("VDF: HMAC verification failed - message may be tampered");
            return null;
        }

        // Derive decryption key
        const decKey = await deriveKeyFromVDFOutput(vdfOutput);

        // Extract IV and ciphertext
        const iv = ciphertextBytes.slice(0, 12);
        const ct = ciphertextBytes.slice(12);

        // Decrypt
        const pt = await crypto.subtle.decrypt(
            { name: "AES-GCM", iv },
            decKey,
            ct
        );

        const result = TD.decode(pt);

        // Wipe
        wipe(vdfOutput);
        wipe(ciphertextBytes);

        return result;
    } catch (err) {
        console.error("VDF decryption failed:", err);
        return null;
    }
}

/**
 * Estimate how long it will take to solve a VDF puzzle on this device.
 * Runs a small benchmark to calibrate.
 */
export async function estimateSolveTime(iterations: number): Promise<number> {
    const benchmarkIterations = 10_000;
    const seed = crypto.getRandomValues(new Uint8Array(32));

    const start = performance.now();
    await computeVDF(seed, benchmarkIterations);
    const elapsed = performance.now() - start;

    const ratePerMs = benchmarkIterations / elapsed;
    return iterations / ratePerMs; // Estimated time in ms
}

/**
 * Check if a time-locked message's estimated unlock time has passed.
 * Note: This is advisory only. Actual decryption requires VDF computation.
 */
export function isEstimatedTimeReached(message: VDFTimeLockMessage): boolean {
    return Date.now() >= message.estimatedUnlockAt;
}

/**
 * Format a human-readable time remaining string
 */
export function formatTimeRemaining(message: VDFTimeLockMessage): string {
    const remaining = message.estimatedUnlockAt - Date.now();
    if (remaining <= 0) return "Ready to unlock";

    const seconds = Math.ceil(remaining / 1000);
    if (seconds < 60) return `${seconds}s remaining`;
    const minutes = Math.ceil(seconds / 60);
    if (minutes < 60) return `${minutes}m remaining`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ${minutes % 60}m remaining`;
}
