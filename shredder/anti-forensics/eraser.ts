"use client";

import { wipe } from "../crypto/crypto";

/**
 * 🧹 THE ERASER - Anti-Forensic Module
 * 
 * Responsibilities:
 * - Detect tab blur/minimization and trigger memory wipe.
 * - Detect lid closure (visibilityState) and trigger auto-wipe.
 * - Overwrite sensevitive global references on session end.
 * - Prevent browser caching and history restoration.
 */

type Cleanable = { wipe: () => void };
const registry = new Set<Cleanable>();

/**
 * Register an object for automatic wiping.
 * The object must implement a .wipe() method.
 */
export function registerForWipe(obj: Cleanable) {
    registry.add(obj);
}

export function unregisterFromWipe(obj: Cleanable) {
    registry.delete(obj);
}

/**
 * Perform a full system wipe.
 * Wipes all registered keys and forces a redirect to clear the session.
 */
export function globalWipe() {
    console.warn("🚨 EMERGENCY WIPE TRIGGERED");

    // 1. Wipe all registered secrets
    for (const obj of registry) {
        try { obj.wipe(); } catch (e) { console.error("Wipe failed for object:", e); }
    }

    // 2. Clear registry
    registry.clear();

    // 3. Prevent back-history restoration by replacing state
    if (typeof window !== "undefined") {
        window.history.replaceState(null, "", "/");
        // 4. Force hard navigation to a neutral site to clear memory heap
        window.location.href = "about:blank";
    }
}

/**
 * Attack Surface: Memory residues.
 * Strategy: Hook into platform events.
 */
export function initAntiForensics(options: {
    wipeOnBlur?: boolean,
    wipeOnMinimize?: boolean,
    wipeOnUnload?: boolean
} = {}) {
    if (typeof window === "undefined") return;

    // Visibility Change (Minimize / Lid Close / Tab Switch)
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") {
            if (options.wipeOnMinimize) globalWipe();
        }
    });

    // Blur (Focus lost - user might be looking elsewhere)
    window.addEventListener("blur", () => {
        if (options.wipeOnBlur) globalWipe();
    });

    // Unload (Tab closed)
    window.addEventListener("beforeunload", () => {
        if (options.wipeOnUnload) globalWipe();
    });

    // Hotkey Panic (Ctrl+Shift+X)
    window.addEventListener("keydown", (e) => {
        if (e.ctrlKey && e.shiftKey && e.code === "KeyX") {
            e.preventDefault();
            globalWipe();
        }
    });

    // Disable browser caching and back-forward cache (BFCache)
    window.onpageshow = (event) => {
        if (event.persisted) {
            // If the page was loaded from BFCache, wipe it immediately
            globalWipe();
        }
    };

    console.log("🛡️ Anti-Forensic Eraser Active");
}
