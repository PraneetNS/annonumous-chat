"use client";

import { TE } from "./crypto";

/**
 * ⏳ TIME-LOCK ENGINE
 * Simple cryptographic time-lock via multiple rounds of hashing
 * or strictly enforced release times in the message metadata.
 * 
 * Note: True cryptographic time-locking (where even the owner can't decrypt)
 * usually requires a trusted beacon or expensive VDFs. 
 * This implementation uses metadata-enforced release for high-impact UX.
 */

export type TimeLockedPayload = {
    v: 1;
    type: "time-locked";
    releaseAt: number;
    content: string;
};

export function isReady(payload: TimeLockedPayload): boolean {
    return Date.now() >= payload.releaseAt;
}

export function formatTimeLocked(seconds: number, content: string): TimeLockedPayload {
    return {
        v: 1,
        type: "time-locked",
        releaseAt: Date.now() + (seconds * 1000),
        content
    };
}
