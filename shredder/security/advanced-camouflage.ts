"use client";

/**
 * 🕶️ ADVANCED METADATA CAMOUFLAGE ENGINE
 * 
 * Enhanced traffic obfuscation with:
 * - Adaptive packet padding (2KB - 8KB random)
 * - Continuous cover traffic generator
 * - Statistical traffic normalization
 * - Bandwidth-aware noise injection
 * 
 * Goal: Make it impossible for network observers to distinguish
 * real messages from background noise through:
 * - Packet size analysis
 * - Timing analysis
 * - Traffic volume analysis
 */

// ── Types ─────────────────────────────────────────────────────────────────

export interface CamouflageConfig {
    /** Minimum packet padding in bytes */
    minPaddingBytes: number;
    /** Maximum packet padding in bytes */
    maxPaddingBytes: number;
    /** Minimum jitter delay in ms */
    minJitterMs: number;
    /** Maximum jitter delay in ms */
    maxJitterMs: number;
    /** Cover traffic interval range (min) in ms */
    minNoiseIntervalMs: number;
    /** Cover traffic interval range (max) in ms */
    maxNoiseIntervalMs: number;
    /** Enable adaptive rate based on real traffic */
    adaptiveRate: boolean;
    /** Target packets per minute (for normalization) */
    targetPacketsPerMinute: number;
}

export interface TrafficStats {
    realPacketsSent: number;
    noisePacketsSent: number;
    totalBytesSent: number;
    paddingBytesSent: number;
    averagePacketSize: number;
    packetsPerMinute: number;
    noiseRatio: number;
}

const DEFAULT_CONFIG: CamouflageConfig = {
    minPaddingBytes: 2048,      // 2KB minimum padding
    maxPaddingBytes: 8192,      // 8KB maximum padding
    minJitterMs: 30,
    maxJitterMs: 500,
    minNoiseIntervalMs: 1000,   // 1 second minimum
    maxNoiseIntervalMs: 8000,   // 8 seconds maximum
    adaptiveRate: true,
    targetPacketsPerMinute: 30
};

// ── Advanced Camouflage Engine ────────────────────────────────────────────

export class AdvancedCamouflageEngine {
    private config: CamouflageConfig;
    private stopped = false;
    private stats: TrafficStats = {
        realPacketsSent: 0,
        noisePacketsSent: 0,
        totalBytesSent: 0,
        paddingBytesSent: 0,
        averagePacketSize: 0,
        packetsPerMinute: 0,
        noiseRatio: 0
    };

    private recentPacketTimestamps: number[] = [];
    private noiseTimer: NodeJS.Timeout | null = null;
    private sendNoise: (data: Uint8Array) => void;
    private startTime: number;

    constructor(
        sendNoise: (data: Uint8Array) => void,
        config: Partial<CamouflageConfig> = {}
    ) {
        this.sendNoise = sendNoise;
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.startTime = Date.now();
    }

    // ── Adaptive Packet Padding ───────────────────────────────────────────

    /**
     * Pad a message to a random size between minPaddingBytes and maxPaddingBytes.
     * This prevents packet size analysis by making all packets look similar.
     * 
     * Format: [4 bytes: original length] [original data] [random padding]
     */
    padMessage(data: Uint8Array): Uint8Array {
        const { minPaddingBytes, maxPaddingBytes } = this.config;

        // Calculate target size: random between min and max, but at least data.length + 4
        const minSize = Math.max(data.length + 4, minPaddingBytes);
        const range = Math.max(0, maxPaddingBytes - minSize);
        const targetSize = minSize + Math.floor(Math.random() * range);

        const padded = new Uint8Array(targetSize);
        const dv = new DataView(padded.buffer);

        // Store original length
        dv.setUint32(0, data.length);
        // Copy original data
        padded.set(data, 4);
        // Fill remaining with random bytes (not zeros, to prevent compression analysis)
        const padding = crypto.getRandomValues(new Uint8Array(targetSize - data.length - 4));
        padded.set(padding, 4 + data.length);

        this.stats.paddingBytesSent += targetSize - data.length - 4;

        return padded;
    }

    /**
     * Unpad a received message
     */
    unpadMessage(padded: Uint8Array): Uint8Array | null {
        if (padded.length < 4) return null;

        const dv = new DataView(padded.buffer, padded.byteOffset);
        const originalLength = dv.getUint32(0);

        if (originalLength > padded.length - 4 || originalLength === 0) return null;

        return padded.slice(4, 4 + originalLength);
    }

    // ── Jitter Injection ──────────────────────────────────────────────────

    /**
     * Schedule a real message send with random jitter.
     * Returns a promise that resolves when the message is sent.
     */
    async scheduleSend(fn: () => void): Promise<void> {
        const { minJitterMs, maxJitterMs } = this.config;
        const delay = Math.random() * (maxJitterMs - minJitterMs) + minJitterMs;

        return new Promise((resolve) => {
            setTimeout(() => {
                fn();
                this.recordRealPacket();
                resolve();
            }, delay);
        });
    }

    /**
     * Send immediately without jitter (for time-sensitive operations)
     */
    sendImmediate(fn: () => void) {
        fn();
        this.recordRealPacket();
    }

    private recordRealPacket() {
        this.stats.realPacketsSent++;
        this.recentPacketTimestamps.push(Date.now());
        this.updateStats();
    }

    // ── Cover Traffic Generator ───────────────────────────────────────────

    /**
     * Start continuous background noise generation.
     * Sends encrypted-looking random packets at random intervals.
     */
    startCoverTraffic() {
        if (this.stopped) return;

        const scheduleNext = () => {
            if (this.stopped) return;

            const { minNoiseIntervalMs, maxNoiseIntervalMs } = this.config;
            let interval = Math.random() * (maxNoiseIntervalMs - minNoiseIntervalMs) + minNoiseIntervalMs;

            // Adaptive rate: adjust noise frequency based on real traffic
            if (this.config.adaptiveRate) {
                interval = this.getAdaptiveInterval(interval);
            }

            this.noiseTimer = setTimeout(() => {
                if (this.stopped) return;

                // Generate noise packet
                const noiseSize = this.config.minPaddingBytes +
                    Math.floor(Math.random() * (this.config.maxPaddingBytes - this.config.minPaddingBytes));

                const noise = crypto.getRandomValues(new Uint8Array(noiseSize));

                // Add noise marker (first 4 bytes = 0x00000000 = length 0)
                // This tells the receiver it's a noise packet
                noise[0] = 0;
                noise[1] = 0;
                noise[2] = 0;
                noise[3] = 0;

                this.sendNoise(noise);
                this.stats.noisePacketsSent++;
                this.stats.totalBytesSent += noiseSize;
                this.recentPacketTimestamps.push(Date.now());
                this.updateStats();

                scheduleNext();
            }, interval);
        };

        scheduleNext();
    }

    /**
     * Calculate adaptive interval based on recent real traffic.
     * If real traffic is high, reduce noise (already enough packets).
     * If real traffic is low, increase noise (maintain constant rate).
     */
    private getAdaptiveInterval(baseInterval: number): number {
        const now = Date.now();
        const oneMinuteAgo = now - 60_000;

        // Count recent real packets
        const recentPackets = this.recentPacketTimestamps.filter(t => t > oneMinuteAgo);
        const currentRate = recentPackets.length;
        const targetRate = this.config.targetPacketsPerMinute;

        if (currentRate >= targetRate) {
            // Real traffic is sufficient, reduce noise
            return baseInterval * 2;
        } else if (currentRate < targetRate * 0.5) {
            // Very low real traffic, increase noise significantly
            return baseInterval * 0.5;
        }

        return baseInterval;
    }

    // ── Statistics ────────────────────────────────────────────────────────

    private updateStats() {
        const now = Date.now();
        const oneMinuteAgo = now - 60_000;

        // Clean old timestamps
        this.recentPacketTimestamps = this.recentPacketTimestamps.filter(t => t > oneMinuteAgo);

        const totalPackets = this.stats.realPacketsSent + this.stats.noisePacketsSent;
        this.stats.packetsPerMinute = this.recentPacketTimestamps.length;
        this.stats.averagePacketSize = totalPackets > 0 ? this.stats.totalBytesSent / totalPackets : 0;
        this.stats.noiseRatio = totalPackets > 0 ? this.stats.noisePacketsSent / totalPackets : 0;
    }

    getStats(): TrafficStats {
        this.updateStats();
        return { ...this.stats };
    }

    /**
     * Check if a received packet is a noise packet
     */
    static isNoisePacket(data: Uint8Array): boolean {
        if (data.length < 4) return true;
        const dv = new DataView(data.buffer, data.byteOffset);
        return dv.getUint32(0) === 0;
    }

    // ── Control ───────────────────────────────────────────────────────────

    stop() {
        this.stopped = true;
        if (this.noiseTimer) {
            clearTimeout(this.noiseTimer);
            this.noiseTimer = null;
        }
    }

    resume() {
        this.stopped = false;
        this.startCoverTraffic();
    }

    /**
     * Update configuration dynamically
     */
    updateConfig(updates: Partial<CamouflageConfig>) {
        this.config = { ...this.config, ...updates };
    }
}
