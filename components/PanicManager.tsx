"use client";

import { useEffect } from "react";
import { initAntiForensics, globalWipe } from "../shredder/anti-forensics/eraser";

/**
 * 🚨 PANIC MANAGER
 * High-level component to manage anti-forensic triggers.
 */
export function PanicManager() {
    useEffect(() => {
        // Initialize with safe defaults for a High Security mode
        initAntiForensics({
            wipeOnBlur: false,
            wipeOnMinimize: false, // Disabled to allow the user to share the Room ID via other apps
            wipeOnUnload: true
        });
    }, []);

    return (
        <div style={{ position: "fixed", top: 20, right: 20, zIndex: 1001 }}>
            <button
                className="panic-btn"
                onClick={() => {
                    if (confirm("🚨 EMERGENCY WIPE? This will destroy all keys and exit.")) {
                        globalWipe();
                    }
                }}
                style={{
                    padding: "8px 16px",
                    borderRadius: 8,
                    background: "#ff7b72",
                    color: "#fff",
                    border: "0",
                    fontWeight: 700,
                    fontSize: 12,
                    cursor: "pointer",
                    boxShadow: "0 4px 12px rgba(255, 123, 114, 0.3)"
                }}
            >
                PANIC (Ctrl+Shift+X)
            </button>
        </div>
    );
}
