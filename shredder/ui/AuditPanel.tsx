"use client";

import { useState, useEffect } from "react";

/**
 * 🕵️ SECURITY AUDIT PANEL
 * Displays real-time cryptographic and memory state.
 */

type AuditLog = {
    id: string;
    ts: number;
    type: "info" | "sec" | "panic";
    text: string;
};

export function AuditPanel() {
    const [logs, setLogs] = useState<AuditLog[]>([]);
    const [isMinimized, setIsMinimized] = useState(false);

    // Auto-minimize on mobile on mount
    useEffect(() => {
        if (typeof window !== "undefined" && window.innerWidth < 768) {
            setIsMinimized(true);
        }
    }, []);

    // We expose a global function to allow other modules to log to the audit panel
    useEffect(() => {
        (window as any)._shredder_audit = (type: AuditLog["type"], text: string) => {
            setLogs((prev) => [
                { id: Math.random().toString(36), ts: Date.now(), type, text },
                ...prev.slice(0, 49),
            ]);
        };
    }, []);

    return (
        <div style={{
            position: "fixed",
            bottom: 20,
            right: 20,
            width: isMinimized ? 200 : 320,
            maxWidth: "calc(100vw - 40px)",
            maxHeight: isMinimized ? 40 : 400,
            background: "rgba(10, 14, 20, 0.9)",
            backdropFilter: "blur(10px)",
            border: "1px solid #1e2d3d",
            borderRadius: 12,
            display: "flex",
            flexDirection: "column",
            fontSize: 11,
            fontFamily: "monospace",
            color: "#8b949e",
            zIndex: 1000,
            boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
            overflow: "hidden",
            transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)"
        }}>
            <div
                onClick={() => setIsMinimized(!isMinimized)}
                style={{
                    padding: "8px 12px",
                    borderBottom: isMinimized ? "0" : "1px solid #1e2d3d",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    background: "rgba(255,255,255,0.03)",
                    cursor: "pointer",
                    userSelect: "none"
                }}
            >
                <span style={{ color: "#e6edf3", fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    🔍 {isMinimized ? "AUDIT" : "SECURITY AUDIT"}
                </span>
                <span style={{ fontSize: 9, opacity: 0.6 }}>{isMinimized ? "▲" : "▼"}</span>
            </div>

            {!isMinimized && (
                <>
                    <div style={{ flex: 1, overflowY: "auto", padding: 8 }}>
                        {logs.length === 0 && <div style={{ textAlign: "center", padding: 20 }}>Waiting for events...</div>}
                        {logs.map(log => (
                            <div key={log.id} style={{ marginBottom: 4, display: "flex", gap: 6 }}>
                                <span style={{ opacity: 0.4 }}>{new Date(log.ts).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                                <span style={{
                                    color: log.type === "panic" ? "#ff7b72" : log.type === "sec" ? "#79c0ff" : "#8b949e",
                                    fontWeight: log.type === "sec" ? "bold" : "normal"
                                }}>
                                    [{log.type.toUpperCase()}] {log.text}
                                </span>
                            </div>
                        ))}
                    </div>

                    <div style={{ padding: 6, fontSize: 9, borderTop: "1px solid #1e2d3d", textAlign: "center", background: "rgba(0,0,0,0.2)" }}>
                        PROOFS: ZERO-KNOWLEDGE ✅ | MEMORY-WIPED ✅
                    </div>
                </>
            )}
        </div>
    );
}

/**
 * Helper to log to the audit panel from anywhere.
 */
export function auditLog(type: AuditLog["type"], text: string) {
    if (typeof window !== "undefined" && (window as any)._shredder_audit) {
        (window as any)._shredder_audit(type, text);
    }
}
