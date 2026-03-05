"use client";

import { useState, useEffect, useCallback } from "react";
import type { MeshStats } from "../network/mesh";
import type { TrafficStats } from "../security/advanced-camouflage";

/**
 * 🏢 ENTERPRISE SECURITY DASHBOARD
 * 
 * Real-time security status display with:
 * - E2EE verification status
 * - PQC security indicator
 * - Metadata obfuscation status
 * - Peer fingerprint verification
 * - Connection strength meter
 * - Network health metrics
 * - Active peer display
 * - Room policy status
 */

// ── Types ─────────────────────────────────────────────────────────────────

export interface SecurityStatus {
    e2eeActive: boolean;
    pqcActive: boolean;
    metadataObfuscation: boolean;
    screenProtection: boolean;
    coverTraffic: boolean;
    vdfAvailable: boolean;
    stegoAvailable: boolean;
}

export interface PeerInfo {
    peerId: string;
    fingerprint: string;
    verified: boolean;
    latencyMs: number;
    connectionState: string;
    bytesExchanged: number;
}

export interface RoomPolicy {
    maxRoomSize: number;
    timeLimit: number | null;
    allowedRegions: string[];
    requirePQC: boolean;
    requireVerification: boolean;
}

export interface DashboardProps {
    securityStatus: SecurityStatus;
    meshStats: MeshStats | null;
    trafficStats: TrafficStats | null;
    peers: PeerInfo[];
    roomPolicy: RoomPolicy;
    roomId: string;
    signalingNode: string | null;
    onVerifyPeer?: (peerId: string) => void;
}

// ── Styles ────────────────────────────────────────────────────────────────

const S = {
    container: {
        position: "fixed" as const,
        top: 20,
        left: 20,
        width: 340,
        maxHeight: "calc(100vh - 40px)",
        background: "rgba(10, 14, 20, 0.95)",
        backdropFilter: "blur(20px)",
        border: "1px solid rgba(30, 45, 61, 0.8)",
        borderRadius: 16,
        display: "flex",
        flexDirection: "column" as const,
        fontSize: 11,
        fontFamily: "'Inter', monospace",
        color: "#8b949e",
        zIndex: 999,
        boxShadow: "0 12px 48px rgba(0,0,0,0.6)",
        overflow: "hidden",
        transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)"
    },
    header: {
        padding: "12px 16px",
        borderBottom: "1px solid rgba(30, 45, 61, 0.8)",
        background: "rgba(255,255,255,0.02)",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        cursor: "pointer",
        userSelect: "none" as const
    },
    section: {
        padding: "10px 16px",
        borderBottom: "1px solid rgba(30, 45, 61, 0.4)"
    },
    badge: (active: boolean) => ({
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "3px 8px",
        borderRadius: 100,
        fontSize: 9,
        fontWeight: 600 as const,
        background: active ? "rgba(63, 185, 80, 0.1)" : "rgba(255, 123, 114, 0.1)",
        color: active ? "#3fb950" : "#ff7b72",
        border: `1px solid ${active ? "rgba(63, 185, 80, 0.2)" : "rgba(255, 123, 114, 0.2)"}`
    }),
    meter: (value: number) => ({
        height: 4,
        borderRadius: 2,
        background: "rgba(255,255,255,0.05)",
        overflow: "hidden" as const,
        position: "relative" as const,
    }),
    meterFill: (value: number) => ({
        height: "100%",
        borderRadius: 2,
        width: `${Math.min(100, value)}%`,
        background: value > 80 ? "#3fb950" : value > 40 ? "#d29922" : "#ff7b72",
        transition: "width 0.5s ease"
    }),
    peerRow: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "6px 0",
        borderBottom: "1px solid rgba(30, 45, 61, 0.2)"
    },
    miniButton: {
        padding: "2px 8px",
        borderRadius: 4,
        border: "1px solid rgba(121, 192, 255, 0.3)",
        background: "rgba(121, 192, 255, 0.05)",
        color: "#79c0ff",
        fontSize: 9,
        cursor: "pointer",
        fontWeight: 600 as const
    }
};

// ── Component ─────────────────────────────────────────────────────────────

export function EnterpriseDashboard({
    securityStatus,
    meshStats,
    trafficStats,
    peers,
    roomPolicy,
    roomId,
    signalingNode,
    onVerifyPeer
}: DashboardProps) {
    const [isMinimized, setIsMinimized] = useState(false);
    const [activeTab, setActiveTab] = useState<"security" | "network" | "peers" | "policy">("security");
    const [uptime, setUptime] = useState(0);

    useEffect(() => {
        const start = Date.now();
        const interval = setInterval(() => setUptime(Date.now() - start), 1000);
        return () => clearInterval(interval);
    }, []);

    useEffect(() => {
        if (typeof window !== "undefined" && window.innerWidth < 768) {
            setIsMinimized(true);
        }
    }, []);

    const formatUptime = (ms: number) => {
        const s = Math.floor(ms / 1000);
        const m = Math.floor(s / 60);
        const h = Math.floor(m / 60);
        if (h > 0) return `${h}h ${m % 60}m`;
        if (m > 0) return `${m}m ${s % 60}s`;
        return `${s}s`;
    };

    const formatBytes = (b: number) => {
        if (b < 1024) return `${b} B`;
        if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
        return `${(b / (1024 * 1024)).toFixed(1)} MB`;
    };

    const connectionHealth = meshStats
        ? Math.min(100, (meshStats.connectedPeers / Math.max(1, meshStats.totalPeers)) * 100)
        : 0;

    return (
        <div style={{
            ...S.container,
            width: isMinimized ? 220 : 340,
            maxHeight: isMinimized ? 44 : "calc(100vh - 40px)"
        }}>
            {/* Header */}
            <div
                style={S.header}
                onClick={() => setIsMinimized(!isMinimized)}
            >
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        background: securityStatus.e2eeActive ? "#3fb950" : "#ff7b72",
                        boxShadow: securityStatus.e2eeActive ? "0 0 8px rgba(63, 185, 80, 0.5)" : "0 0 8px rgba(255, 123, 114, 0.5)"
                    }} />
                    <span style={{ color: "#e6edf3", fontWeight: 700, fontSize: 12 }}>
                        {isMinimized ? "SECURITY" : "🛡️ ENTERPRISE SECURITY"}
                    </span>
                </div>
                <span style={{ fontSize: 9, opacity: 0.6 }}>
                    {isMinimized ? "▼" : "▲"}
                </span>
            </div>

            {!isMinimized && (
                <>
                    {/* Tab Bar */}
                    <div style={{
                        display: "flex",
                        borderBottom: "1px solid rgba(30, 45, 61, 0.8)",
                        background: "rgba(0,0,0,0.2)"
                    }}>
                        {(["security", "network", "peers", "policy"] as const).map(tab => (
                            <button
                                key={tab}
                                onClick={() => setActiveTab(tab)}
                                style={{
                                    flex: 1,
                                    padding: "8px 0",
                                    background: activeTab === tab ? "rgba(121, 192, 255, 0.05)" : "transparent",
                                    border: "none",
                                    borderBottom: activeTab === tab ? "2px solid #79c0ff" : "2px solid transparent",
                                    color: activeTab === tab ? "#79c0ff" : "#8b949e",
                                    fontSize: 9,
                                    fontWeight: 600,
                                    cursor: "pointer",
                                    textTransform: "uppercase" as const,
                                    letterSpacing: "0.5px"
                                }}
                            >
                                {tab}
                            </button>
                        ))}
                    </div>

                    {/* Content */}
                    <div style={{ flex: 1, overflowY: "auto" }}>
                        {/* Security Tab */}
                        {activeTab === "security" && (
                            <div style={S.section}>
                                <div style={{ marginBottom: 12, fontSize: 10, fontWeight: 600, color: "#e6edf3", textTransform: "uppercase" as const, letterSpacing: "0.5px" }}>
                                    Protection Status
                                </div>

                                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
                                    <span style={S.badge(securityStatus.e2eeActive)}>
                                        {securityStatus.e2eeActive ? "🔒" : "🔓"} E2EE
                                    </span>
                                    <span style={S.badge(securityStatus.pqcActive)}>
                                        {securityStatus.pqcActive ? "🛡️" : "⚠️"} PQC
                                    </span>
                                    <span style={S.badge(securityStatus.metadataObfuscation)}>
                                        {securityStatus.metadataObfuscation ? "👁️" : "⚠️"} META
                                    </span>
                                    <span style={S.badge(securityStatus.screenProtection)}>
                                        {securityStatus.screenProtection ? "📸" : "⚠️"} SCREEN
                                    </span>
                                    <span style={S.badge(securityStatus.coverTraffic)}>
                                        {securityStatus.coverTraffic ? "📡" : "⚠️"} COVER
                                    </span>
                                    <span style={S.badge(securityStatus.vdfAvailable)}>
                                        {securityStatus.vdfAvailable ? "⏳" : "⚠️"} VDF
                                    </span>
                                    <span style={S.badge(securityStatus.stegoAvailable)}>
                                        {securityStatus.stegoAvailable ? "🖼️" : "⚠️"} STEGO
                                    </span>
                                </div>

                                <div style={{ fontSize: 9, color: "#58a6ff", padding: "6px 8px", background: "rgba(88, 166, 255, 0.05)", borderRadius: 6, border: "1px solid rgba(88, 166, 255, 0.1)" }}>
                                    {securityStatus.pqcActive
                                        ? "🔐 ECDH-P384 + Kyber-768 Hybrid | Dilithium-3"
                                        : "🔐 ECDH-P384 | AES-256-GCM"
                                    }
                                </div>

                                <div style={{ marginTop: 10, fontSize: 9, opacity: 0.6 }}>
                                    Session Uptime: {formatUptime(uptime)}
                                </div>
                            </div>
                        )}

                        {/* Network Tab */}
                        {activeTab === "network" && (
                            <div style={S.section}>
                                <div style={{ marginBottom: 12, fontSize: 10, fontWeight: 600, color: "#e6edf3", textTransform: "uppercase" as const, letterSpacing: "0.5px" }}>
                                    Network Health
                                </div>

                                {/* Connection Strength Meter */}
                                <div style={{ marginBottom: 12 }}>
                                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                                        <span>Connection Strength</span>
                                        <span style={{ color: connectionHealth > 80 ? "#3fb950" : connectionHealth > 40 ? "#d29922" : "#ff7b72" }}>
                                            {Math.round(connectionHealth)}%
                                        </span>
                                    </div>
                                    <div style={S.meter(connectionHealth)}>
                                        <div style={S.meterFill(connectionHealth)} />
                                    </div>
                                </div>

                                {meshStats && (
                                    <>
                                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
                                            <div style={{ padding: 8, background: "rgba(255,255,255,0.02)", borderRadius: 6 }}>
                                                <div style={{ fontSize: 16, fontWeight: 700, color: "#e6edf3" }}>
                                                    {meshStats.connectedPeers}/{meshStats.totalPeers}
                                                </div>
                                                <div style={{ fontSize: 8, opacity: 0.6 }}>PEERS</div>
                                            </div>
                                            <div style={{ padding: 8, background: "rgba(255,255,255,0.02)", borderRadius: 6 }}>
                                                <div style={{ fontSize: 16, fontWeight: 700, color: "#e6edf3" }}>
                                                    {meshStats.averageLatencyMs}ms
                                                </div>
                                                <div style={{ fontSize: 8, opacity: 0.6 }}>LATENCY</div>
                                            </div>
                                        </div>

                                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
                                            <div style={{ padding: 8, background: "rgba(255,255,255,0.02)", borderRadius: 6 }}>
                                                <div style={{ fontSize: 12, fontWeight: 600, color: "#e6edf3" }}>
                                                    {formatBytes(meshStats.totalBytesSent)}
                                                </div>
                                                <div style={{ fontSize: 8, opacity: 0.6 }}>SENT</div>
                                            </div>
                                            <div style={{ padding: 8, background: "rgba(255,255,255,0.02)", borderRadius: 6 }}>
                                                <div style={{ fontSize: 12, fontWeight: 600, color: "#e6edf3" }}>
                                                    {formatBytes(meshStats.totalBytesReceived)}
                                                </div>
                                                <div style={{ fontSize: 8, opacity: 0.6 }}>RECEIVED</div>
                                            </div>
                                        </div>

                                        <div style={{
                                            display: "flex",
                                            alignItems: "center",
                                            gap: 6,
                                            padding: "6px 8px",
                                            background: meshStats.meshHealth === "excellent" ? "rgba(63,185,80,0.05)"
                                                : meshStats.meshHealth === "good" ? "rgba(210,153,34,0.05)"
                                                    : "rgba(255,123,114,0.05)",
                                            borderRadius: 6,
                                            fontSize: 9
                                        }}>
                                            <span style={{
                                                width: 6,
                                                height: 6,
                                                borderRadius: "50%",
                                                background: meshStats.meshHealth === "excellent" ? "#3fb950"
                                                    : meshStats.meshHealth === "good" ? "#d29922"
                                                        : "#ff7b72"
                                            }} />
                                            Mesh Health: {meshStats.meshHealth.toUpperCase()}
                                        </div>
                                    </>
                                )}

                                {trafficStats && (
                                    <div style={{ marginTop: 12 }}>
                                        <div style={{ fontSize: 10, fontWeight: 600, color: "#e6edf3", marginBottom: 8 }}>
                                            Traffic Camouflage
                                        </div>
                                        <div style={{ fontSize: 9 }}>
                                            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
                                                <span>Real Packets</span>
                                                <span style={{ color: "#e6edf3" }}>{trafficStats.realPacketsSent}</span>
                                            </div>
                                            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
                                                <span>Noise Packets</span>
                                                <span style={{ color: "#e6edf3" }}>{trafficStats.noisePacketsSent}</span>
                                            </div>
                                            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
                                                <span>Noise Ratio</span>
                                                <span style={{ color: "#e6edf3" }}>
                                                    {(trafficStats.noiseRatio * 100).toFixed(1)}%
                                                </span>
                                            </div>
                                            <div style={{ display: "flex", justifyContent: "space-between" }}>
                                                <span>Packets/min</span>
                                                <span style={{ color: "#e6edf3" }}>{trafficStats.packetsPerMinute}</span>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {signalingNode && (
                                    <div style={{ marginTop: 10, fontSize: 9, opacity: 0.6 }}>
                                        Node: {signalingNode}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Peers Tab */}
                        {activeTab === "peers" && (
                            <div style={S.section}>
                                <div style={{ marginBottom: 12, fontSize: 10, fontWeight: 600, color: "#e6edf3", textTransform: "uppercase" as const, letterSpacing: "0.5px" }}>
                                    Connected Peers ({peers.length})
                                </div>

                                {peers.length === 0 ? (
                                    <div style={{ textAlign: "center", padding: 20, opacity: 0.5 }}>
                                        No peers connected
                                    </div>
                                ) : (
                                    peers.map(peer => (
                                        <div key={peer.peerId} style={S.peerRow}>
                                            <div>
                                                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                                    <span style={{
                                                        width: 6,
                                                        height: 6,
                                                        borderRadius: "50%",
                                                        background: peer.connectionState === "connected" ? "#3fb950" : "#ff7b72"
                                                    }} />
                                                    <span style={{ color: "#e6edf3", fontSize: 10, fontWeight: 600 }}>
                                                        {peer.fingerprint.slice(0, 12)}
                                                    </span>
                                                    {peer.verified && (
                                                        <span style={{ fontSize: 8, color: "#3fb950" }}>✓</span>
                                                    )}
                                                </div>
                                                <div style={{ fontSize: 8, marginTop: 2 }}>
                                                    {peer.latencyMs}ms • {formatBytes(peer.bytesExchanged)}
                                                </div>
                                            </div>
                                            {!peer.verified && onVerifyPeer && (
                                                <button
                                                    style={S.miniButton}
                                                    onClick={() => onVerifyPeer(peer.peerId)}
                                                >
                                                    Verify
                                                </button>
                                            )}
                                        </div>
                                    ))
                                )}
                            </div>
                        )}

                        {/* Policy Tab */}
                        {activeTab === "policy" && (
                            <div style={S.section}>
                                <div style={{ marginBottom: 12, fontSize: 10, fontWeight: 600, color: "#e6edf3", textTransform: "uppercase" as const, letterSpacing: "0.5px" }}>
                                    Room Policy
                                </div>

                                <div style={{ fontSize: 9 }}>
                                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                                        <span>Max Room Size</span>
                                        <span style={{ color: "#e6edf3" }}>{roomPolicy.maxRoomSize}</span>
                                    </div>
                                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                                        <span>Time Limit</span>
                                        <span style={{ color: "#e6edf3" }}>
                                            {roomPolicy.timeLimit ? `${roomPolicy.timeLimit}m` : "None"}
                                        </span>
                                    </div>
                                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                                        <span>PQC Required</span>
                                        <span style={{ color: roomPolicy.requirePQC ? "#3fb950" : "#8b949e" }}>
                                            {roomPolicy.requirePQC ? "Yes" : "No"}
                                        </span>
                                    </div>
                                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                                        <span>Verification Required</span>
                                        <span style={{ color: roomPolicy.requireVerification ? "#3fb950" : "#8b949e" }}>
                                            {roomPolicy.requireVerification ? "Yes" : "No"}
                                        </span>
                                    </div>
                                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                                        <span>Allowed Regions</span>
                                        <span style={{ color: "#e6edf3" }}>
                                            {roomPolicy.allowedRegions.length > 0
                                                ? roomPolicy.allowedRegions.join(", ")
                                                : "Global"
                                            }
                                        </span>
                                    </div>
                                </div>

                                <div style={{ marginTop: 12, padding: "6px 8px", background: "rgba(255,255,255,0.02)", borderRadius: 6, fontSize: 8, opacity: 0.6 }}>
                                    Room: {roomId.slice(0, 16)}...
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Footer */}
                    <div style={{
                        padding: "6px 16px",
                        fontSize: 8,
                        borderTop: "1px solid rgba(30, 45, 61, 0.8)",
                        textAlign: "center",
                        background: "rgba(0,0,0,0.2)",
                        color: "#58a6ff"
                    }}>
                        DIGITAL SHREDDER v2.0 • ENTERPRISE
                    </div>
                </>
            )}
        </div>
    );
}
