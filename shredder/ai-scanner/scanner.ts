"use client";

/**
 * 🧠 LOCAL AI SCANNER - Privacy Guard
 * 
 * Responsibilities:
 * - Detect sensitive data (PII) before it leaves the client.
 * - Entropy analysis to find secret keys/hashes.
 * - Pattern matching for Emails, Phones, Banking info.
 * - ZERO network calls.
 */

const PATTERNS: Record<string, RegExp> = {
    EMAIL: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
    PHONE: /(\+?\d{1,4}?[-.\s]?(\(?\d{1,3}?\)?[-.\s]?)?\d{1,4}[-.\s]?\d{1,4}[-.\s]?\d{1,9})/g,
    CREDIT_CARD: /\b(?:\d[ -]*?){13,16}\b/g,
    CRYPTO_ADDR: /\b(?:0x[a-fA-F0-9]{40}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})\b/g,
    IPV4: /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g,
};

/**
 * Calculate Shannon Entropy of a string to detect keys/passwords.
 */
function calculateEntropy(str: string): number {
    const len = str.length;
    if (!len) return 0;
    const frequencies: Record<string, number> = {};
    for (let i = 0; i < len; i++) {
        const char = str[i];
        if (char !== undefined) {
            frequencies[char] = (frequencies[char] || 0) + 1;
        }
    }
    let entropy = 0;
    for (const char in frequencies) {
        const count = frequencies[char];
        if (typeof count === 'number') {
            const p = count / len;
            entropy -= p * Math.log2(p);
        }
    }
    return entropy;
}

export type ScanResult = {
    sensitive: boolean;
    matches: string[];
    highEntropy: boolean;
};

/**
 * Scans text locally for potential leaks.
 */
export function scanSensitivity(text: string): ScanResult {
    const matches: string[] = [];

    // 1. Pattern Matching (PII)
    for (const [name, regex] of Object.entries(PATTERNS)) {
        const found = text.match(regex);
        if (found) {
            matches.push(`${name} detected`);
        }
    }

    // 2. Entropy Check (Keys/Hashes)
    // We split by whitespace and check each "word" for high randomness
    const words = text.split(/\s+/);
    let highEntropy = false;
    for (const word of words) {
        if (word.length > 20) {
            const e = calculateEntropy(word);
            // High entropy for a long string usually means a key or hash
            if (e > 4.5) {
                highEntropy = true;
                matches.push("High-entropy string detected (possible key/token)");
                break;
            }
        }
    }

    return {
        sensitive: matches.length > 0,
        matches,
        highEntropy
    };
}
