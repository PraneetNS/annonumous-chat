"use client";

/**
 * 🕶️ METADATA CAMOUFLAGE ENGINE
 * 
 * Responsibilities:
 * - Jitter Injection: Randomize the delay between sending packets.
 * - Noise Packets: Send "dummy" encrypted-looking packets to throw off traffic analysis.
 * - Packet Normalization: (Handled by crypto.ts via 4KB padding).
 */

export class CamouflageEngine {
    private stopped = false;

    constructor(
        private sendNoise: () => void,
        private minJitterMs = 50,
        private maxJitterMs = 300
    ) { }

    /**
     * Schedules a real message send with random jitter.
     */
    async scheduleSend(fn: () => void) {
        const delay = Math.random() * (this.maxJitterMs - this.minJitterMs) + this.minJitterMs;
        return new Promise((resolve) => {
            setTimeout(() => {
                fn();
                resolve(true);
            }, delay);
        });
    }

    /**
     * Starts an background process that sends "noise" packets at random intervals.
     * This makes it impossible to tell when a real person is actually typing vs idling.
     */
    startNoiseGenerator() {
        const next = () => {
            if (this.stopped) return;

            // Random interval between 2 and 10 seconds for noise
            const delay = Math.random() * 8000 + 2000;
            setTimeout(() => {
                if (!this.stopped) {
                    this.sendNoise();
                    next();
                }
            }, delay);
        };
        next();
    }

    stop() {
        this.stopped = true;
    }
}
