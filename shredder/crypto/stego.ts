"use client";

/**
 * 🖼️ STEGANOGRAPHIC SIGNALING MODULE
 * 
 * Hides signaling data inside PNG images using LSB (Least Significant Bit) steganography.
 * This provides a covert transport channel that disguises WebRTC signaling
 * as innocuous image uploads.
 * 
 * Methods:
 * - LSB Steganography: Embed data in the least significant bits of pixel values
 * - Pixel Noise Embedding: Distribute data across pseudo-random pixel positions
 * 
 * Encoding format:
 * [4 bytes: data length] [N bytes: payload] [remaining: noise]
 * Each byte is spread across 8 pixels (1 bit per pixel channel)
 * 
 * Security:
 * - Changes to pixel values are imperceptible to human vision
 * - Statistical analysis resistance via noise distribution
 * - Capacity: ~(width * height * 3) / 8 bytes per image
 */

import { TE, TD, b64urlEncode, b64urlDecode } from "./crypto";

// ── Types ─────────────────────────────────────────────────────────────────

export interface StegoImage {
    width: number;
    height: number;
    dataUrl: string;
    capacityBytes: number;
    usedBytes: number;
}

export interface StegoConfig {
    /** Use noise distribution (harder to detect) vs sequential LSB */
    useNoiseDistribution: boolean;
    /** PRNG seed for noise distribution (must match between encoder/decoder) */
    seed?: number;
    /** Bits per channel to use (1-2, higher = more capacity but more visible) */
    bitsPerChannel: 1 | 2;
}

const DEFAULT_CONFIG: StegoConfig = {
    useNoiseDistribution: true,
    seed: 0x5HRED,
    bitsPerChannel: 1
};

// ── PRNG for pixel position distribution ──────────────────────────────────

class SeededRNG {
    private state: number;

    constructor(seed: number) {
        this.state = seed;
    }

    /** Mulberry32 PRNG - deterministic, fast, good distribution */
    next(): number {
        this.state |= 0;
        this.state = (this.state + 0x6D2B79F5) | 0;
        let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }

    /** Generate a shuffled index array using Fisher-Yates */
    shuffleIndices(length: number): number[] {
        const indices = Array.from({ length }, (_, i) => i);
        for (let i = length - 1; i > 0; i--) {
            const j = Math.floor(this.next() * (i + 1));
            [indices[i], indices[j]] = [indices[j]!, indices[i]!];
        }
        return indices;
    }
}

// ── Canvas Utilities ──────────────────────────────────────────────────────

/**
 * Create a cover image (carrier) for steganographic embedding.
 * Generates a natural-looking image with gradients and noise.
 */
export function createCoverImage(width = 256, height = 256): ImageData {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d")!;

    // Generate a natural-looking gradient background
    const gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, `hsl(${Math.random() * 360}, 60%, 70%)`);
    gradient.addColorStop(0.5, `hsl(${Math.random() * 360}, 50%, 60%)`);
    gradient.addColorStop(1, `hsl(${Math.random() * 360}, 40%, 50%)`);

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    // Add natural-looking noise
    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
        const noise = Math.floor(Math.random() * 10) - 5;
        data[i] = Math.max(0, Math.min(255, data[i]! + noise));
        data[i + 1] = Math.max(0, Math.min(255, data[i + 1]! + noise));
        data[i + 2] = Math.max(0, Math.min(255, data[i + 2]! + noise));
    }

    ctx.putImageData(imageData, 0, 0);
    return ctx.getImageData(0, 0, width, height);
}

/**
 * Load an image from a URL or data URL into ImageData
 */
export async function loadImage(src: string): Promise<ImageData> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => {
            const canvas = document.createElement("canvas");
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext("2d")!;
            ctx.drawImage(img, 0, 0);
            resolve(ctx.getImageData(0, 0, img.width, img.height));
        };
        img.onerror = reject;
        img.src = src;
    });
}

/**
 * Convert ImageData to a PNG data URL
 */
function imageDataToDataUrl(imageData: ImageData): string {
    const canvas = document.createElement("canvas");
    canvas.width = imageData.width;
    canvas.height = imageData.height;
    const ctx = canvas.getContext("2d")!;
    ctx.putImageData(imageData, 0, 0);
    return canvas.toDataURL("image/png");
}

/**
 * Convert ImageData to a Blob
 */
export function imageDataToBlob(imageData: ImageData): Promise<Blob> {
    return new Promise((resolve, reject) => {
        const canvas = document.createElement("canvas");
        canvas.width = imageData.width;
        canvas.height = imageData.height;
        const ctx = canvas.getContext("2d")!;
        ctx.putImageData(imageData, 0, 0);
        canvas.toBlob((blob) => {
            if (blob) resolve(blob);
            else reject(new Error("Failed to create blob"));
        }, "image/png");
    });
}

// ── LSB Steganography Core ────────────────────────────────────────────────

/**
 * Calculate the maximum payload capacity of an image
 */
export function calculateCapacity(width: number, height: number, bitsPerChannel: number = 1): number {
    // Each pixel has RGB channels (skip alpha for stability)
    // Each channel contributes `bitsPerChannel` bits
    const totalBits = width * height * 3 * bitsPerChannel;
    // Reserve 4 bytes for length header
    return Math.floor(totalBits / 8) - 4;
}

/**
 * Encode data into an image using LSB steganography.
 * 
 * @param data - The data string to hide
 * @param coverImage - The carrier image (if null, generates one)
 * @param config - Steganography configuration
 * @returns The stego image with hidden data
 */
export function stegoEncode(
    data: string,
    coverImage?: ImageData,
    config: StegoConfig = DEFAULT_CONFIG
): StegoImage {
    const payload = TE.encode(data);

    // Calculate required image size if no cover provided
    const requiredBits = (payload.length + 4) * 8; // +4 for length header
    const requiredPixels = Math.ceil(requiredBits / (3 * config.bitsPerChannel));
    const minDimension = Math.ceil(Math.sqrt(requiredPixels));

    if (!coverImage) {
        const size = Math.max(256, minDimension + 32); // Add padding
        coverImage = createCoverImage(size, size);
    }

    const capacity = calculateCapacity(
        coverImage.width,
        coverImage.height,
        config.bitsPerChannel
    );

    if (payload.length > capacity) {
        throw new Error(`Payload too large: ${payload.length} bytes, capacity: ${capacity} bytes`);
    }

    // Create output image data (copy)
    const output = new ImageData(
        new Uint8ClampedArray(coverImage.data),
        coverImage.width,
        coverImage.height
    );
    const pixels = output.data;

    // Prepare payload with 4-byte length header
    const fullPayload = new Uint8Array(payload.length + 4);
    const dv = new DataView(fullPayload.buffer);
    dv.setUint32(0, payload.length);
    fullPayload.set(payload, 4);

    // Generate pixel order (sequential or noise-distributed)
    const totalChannels = coverImage.width * coverImage.height * 3;
    let channelOrder: number[];

    if (config.useNoiseDistribution && config.seed !== undefined) {
        const rng = new SeededRNG(config.seed);
        channelOrder = rng.shuffleIndices(totalChannels);
    } else {
        channelOrder = Array.from({ length: totalChannels }, (_, i) => i);
    }

    // Embed bits
    const mask = config.bitsPerChannel === 1 ? 0xFE : 0xFC;
    let bitIndex = 0;

    for (let byteIdx = 0; byteIdx < fullPayload.length; byteIdx++) {
        const byte = fullPayload[byteIdx]!;

        for (let bit = 7; bit >= 0; bit -= config.bitsPerChannel) {
            if (bitIndex >= channelOrder.length) break;

            const channelIdx = channelOrder[bitIndex]!;
            // Convert channel index to pixel data index (skip alpha channel)
            const pixelIdx = Math.floor(channelIdx / 3);
            const channel = channelIdx % 3;
            const dataIdx = pixelIdx * 4 + channel;

            if (config.bitsPerChannel === 1) {
                const bitVal = (byte >> bit) & 1;
                pixels[dataIdx] = (pixels[dataIdx]! & mask) | bitVal;
            } else {
                const bits2 = (byte >> (bit - 1)) & 3;
                pixels[dataIdx] = (pixels[dataIdx]! & mask) | bits2;
            }

            bitIndex++;
        }
    }

    const dataUrl = imageDataToDataUrl(output);

    return {
        width: output.width,
        height: output.height,
        dataUrl,
        capacityBytes: capacity,
        usedBytes: payload.length
    };
}

/**
 * Decode hidden data from a stego image.
 * 
 * @param imageData - The image containing hidden data
 * @param config - Must match the config used during encoding
 * @returns The decoded data string, or null if extraction fails
 */
export function stegoDecode(
    imageData: ImageData,
    config: StegoConfig = DEFAULT_CONFIG
): string | null {
    try {
        const pixels = imageData.data;
        const totalChannels = imageData.width * imageData.height * 3;

        // Generate same pixel order as encoder
        let channelOrder: number[];
        if (config.useNoiseDistribution && config.seed !== undefined) {
            const rng = new SeededRNG(config.seed);
            channelOrder = rng.shuffleIndices(totalChannels);
        } else {
            channelOrder = Array.from({ length: totalChannels }, (_, i) => i);
        }

        // Extract bits
        function extractByte(startBit: number): number {
            let byte = 0;
            for (let bit = 7; bit >= 0; bit -= config.bitsPerChannel) {
                const ci = startBit + (7 - bit) / config.bitsPerChannel;
                if (ci >= channelOrder.length) break;

                const channelIdx = channelOrder[Math.floor(ci)]!;
                const pixelIdx = Math.floor(channelIdx / 3);
                const channel = channelIdx % 3;
                const dataIdx = pixelIdx * 4 + channel;

                if (config.bitsPerChannel === 1) {
                    byte |= (pixels[dataIdx]! & 1) << bit;
                } else {
                    byte |= (pixels[dataIdx]! & 3) << (bit - 1);
                }
            }
            return byte;
        }

        // Read 4-byte length header
        const bitsPerByte = 8 / config.bitsPerChannel;
        const headerBytes = new Uint8Array(4);
        for (let i = 0; i < 4; i++) {
            headerBytes[i] = extractByte(i * bitsPerByte);
        }
        const dv = new DataView(headerBytes.buffer);
        const payloadLength = dv.getUint32(0);

        // Sanity check
        const capacity = calculateCapacity(
            imageData.width,
            imageData.height,
            config.bitsPerChannel
        );
        if (payloadLength > capacity || payloadLength <= 0 || payloadLength > 1_000_000) {
            return null;
        }

        // Extract payload
        const payload = new Uint8Array(payloadLength);
        for (let i = 0; i < payloadLength; i++) {
            payload[i] = extractByte((i + 4) * bitsPerByte);
        }

        return TD.decode(payload);
    } catch (err) {
        console.error("Stego decode error:", err);
        return null;
    }
}

/**
 * Encode signaling data into a steganographic image for covert transport.
 * This wraps the core stegoEncode with signaling-specific formatting.
 */
export function encodeSignalingPayload(signalingData: object): StegoImage {
    const json = JSON.stringify(signalingData);
    return stegoEncode(json);
}

/**
 * Decode signaling data from a steganographic image.
 */
export async function decodeSignalingPayload(imageSource: string): Promise<object | null> {
    try {
        const imageData = await loadImage(imageSource);
        const decoded = stegoDecode(imageData);
        if (!decoded) return null;
        return JSON.parse(decoded);
    } catch {
        return null;
    }
}
