"use client";

/**
 * 📡 DISTRIBUTED SIGNALING CLIENT
 * 
 * Replaces single signaling server with multi-node failover architecture.
 * 
 * Features:
 * - Node registry with health monitoring
 * - Automatic failover on node failure
 * - Load balancing via random node selection
 * - Node rotation for traffic analysis resistance
 * - Reconnection with exponential backoff
 * 
 * Architecture:
 *   Client → [Node A] ──╮
 *   Client → [Node B] ──┤ Mesh Signaling Network
 *   Client → [Node C] ──╯
 */

// ── Types ─────────────────────────────────────────────────────────────────

export interface SignalingNode {
    id: string;
    url: string;
    region: string;
    priority: number;
    healthy: boolean;
    latencyMs: number;
    lastChecked: number;
    failureCount: number;
}

export interface DistributedSignalingConfig {
    /** List of signaling node URLs */
    nodes: string[];
    /** Maximum reconnection attempts per node */
    maxReconnectAttempts: number;
    /** Base delay for exponential backoff (ms) */
    baseReconnectDelayMs: number;
    /** Maximum reconnect delay (ms) */
    maxReconnectDelayMs: number;
    /** Node rotation interval (ms) - 0 to disable */
    nodeRotationIntervalMs: number;
    /** Health check interval (ms) */
    healthCheckIntervalMs: number;
}

export type DistributedSignalingEvent =
    | { t: "OFFER"; from: string; sdp: RTCSessionDescriptionInit }
    | { t: "ANSWER"; from: string; sdp: RTCSessionDescriptionInit }
    | { t: "ICE"; from: string; candidate: RTCIceCandidateInit }
    | { t: "MATCH"; roomId: string }
    | { t: "PUBKEY"; jwk: JsonWebKey; from?: string }
    | { t: "MESH_OFFER"; peerId: string; targetPeerId: string; sdp: RTCSessionDescriptionInit }
    | { t: "MESH_ANSWER"; peerId: string; targetPeerId: string; sdp: RTCSessionDescriptionInit }
    | { t: "MESH_ICE"; peerId: string; targetPeerId: string; candidate: RTCIceCandidateInit }
    | { t: "PEER_JOIN"; peerId: string; fingerprint: string }
    | { t: "PEER_LEAVE"; peerId: string }
    | { t: "ROOM_INFO"; peers: string[]; roomId: string }
    | { t: "PQC_BUNDLE"; from: string; bundle: any }
    | { t: "NODE_SWITCH"; nodeId: string };

export type SignalingState = "disconnected" | "connecting" | "connected" | "reconnecting" | "failed";

const DEFAULT_CONFIG: DistributedSignalingConfig = {
    nodes: [],
    maxReconnectAttempts: 5,
    baseReconnectDelayMs: 1000,
    maxReconnectDelayMs: 30000,
    nodeRotationIntervalMs: 0, // Disabled by default
    healthCheckIntervalMs: 30000
};

// ── Distributed Signaling Client ──────────────────────────────────────────

export class DistributedSignalingClient {
    private ws: WebSocket | null = null;
    private nodes: SignalingNode[] = [];
    private currentNodeIndex: number = -1;
    private reconnectAttempts: number = 0;
    private reconnectTimer: NodeJS.Timeout | null = null;
    private rotationTimer: NodeJS.Timeout | null = null;
    private healthCheckTimer: NodeJS.Timeout | null = null;
    private config: DistributedSignalingConfig;
    private roomId: string;
    private state: SignalingState = "disconnected";
    private onEvent: (ev: DistributedSignalingEvent) => void;
    private onReady?: () => void;
    private onStateChange?: (state: SignalingState) => void;
    private destroyed = false;
    private messageQueue: any[] = [];

    constructor(
        roomId: string,
        config: Partial<DistributedSignalingConfig>,
        onEvent: (ev: DistributedSignalingEvent) => void,
        onReady?: () => void,
        onStateChange?: (state: SignalingState) => void
    ) {
        this.roomId = roomId;
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.onEvent = onEvent;
        if (onReady) this.onReady = onReady;
        if (onStateChange) this.onStateChange = onStateChange;

        // Initialize node registry
        this.initializeNodes();
    }

    // ── Node Registry ─────────────────────────────────────────────────────

    private initializeNodes() {
        // If no nodes configured, use current origin as default
        if (this.config.nodes.length === 0) {
            if (typeof window !== "undefined") {
                const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
                this.config.nodes = [`${protocol}//${window.location.host}/signaling`];
            }
        }

        this.nodes = this.config.nodes.map((url, index) => ({
            id: `node-${index}`,
            url,
            region: "auto",
            priority: index,
            healthy: true,
            latencyMs: 0,
            lastChecked: 0,
            failureCount: 0
        }));
    }

    /**
     * Get the best available node based on health and latency
     */
    private selectNode(): SignalingNode | null {
        const healthyNodes = this.nodes.filter(n => n.healthy);

        if (healthyNodes.length === 0) {
            // Reset all nodes and try again
            for (const node of this.nodes) {
                node.healthy = true;
                node.failureCount = 0;
            }
            return this.nodes.length > 0 ? this.nodes[Math.floor(Math.random() * this.nodes.length)]! : null;
        }

        // Random selection among healthy nodes (load balancing)
        return healthyNodes[Math.floor(Math.random() * healthyNodes.length)]!;
    }

    // ── Connection ────────────────────────────────────────────────────────

    connect() {
        if (this.destroyed) return;

        const node = this.selectNode();
        if (!node) {
            this.setState("failed");
            return;
        }

        this.currentNodeIndex = this.nodes.indexOf(node);
        this.setState("connecting");

        try {
            this.ws = new WebSocket(node.url);
        } catch {
            this.handleNodeFailure(node);
            return;
        }

        const connectStart = performance.now();

        this.ws.onopen = () => {
            node.latencyMs = performance.now() - connectStart;
            node.failureCount = 0;
            node.healthy = true;
            node.lastChecked = Date.now();

            this.reconnectAttempts = 0;
            this.setState("connected");

            // Join the room
            this.sendDirect({ t: "JOIN", roomId: this.roomId });

            // Flush message queue
            for (const msg of this.messageQueue) {
                this.sendDirect(msg);
            }
            this.messageQueue = [];

            // Start node rotation if configured
            if (this.config.nodeRotationIntervalMs > 0) {
                this.startNodeRotation();
            }

            // Start health checks
            this.startHealthChecks();

            if (this.onReady) this.onReady();
        };

        this.ws.onmessage = (e) => {
            try {
                const data = JSON.parse(e.data);
                this.onEvent(data);
            } catch (err) {
                console.error("Distributed signaling parse error:", err);
            }
        };

        this.ws.onerror = () => {
            this.handleNodeFailure(node);
        };

        this.ws.onclose = (e) => {
            if (this.destroyed) return;

            if (e.code !== 1000) {
                // Abnormal close - attempt reconnect
                this.handleReconnect();
            }
        };
    }

    // ── Sending ───────────────────────────────────────────────────────────

    send(payload: any) {
        if (this.ws?.readyState === WebSocket.OPEN) {
            this.sendDirect(payload);
        } else {
            // Queue for later
            this.messageQueue.push(payload);
        }
    }

    private sendDirect(payload: any) {
        if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(payload));
        }
    }

    // ── Failover & Reconnection ───────────────────────────────────────────

    private handleNodeFailure(node: SignalingNode) {
        node.failureCount++;
        if (node.failureCount >= 3) {
            node.healthy = false;
        }
        this.handleReconnect();
    }

    private handleReconnect() {
        if (this.destroyed) return;

        this.reconnectAttempts++;

        if (this.reconnectAttempts > this.config.maxReconnectAttempts * this.nodes.length) {
            this.setState("failed");
            return;
        }

        this.setState("reconnecting");

        // Exponential backoff with jitter
        const baseDelay = this.config.baseReconnectDelayMs * Math.pow(2, Math.min(this.reconnectAttempts, 6));
        const jitter = Math.random() * baseDelay * 0.3;
        const delay = Math.min(baseDelay + jitter, this.config.maxReconnectDelayMs);

        this.reconnectTimer = setTimeout(() => {
            this.connect();
        }, delay);
    }

    // ── Node Rotation ─────────────────────────────────────────────────────

    private startNodeRotation() {
        if (this.rotationTimer) clearInterval(this.rotationTimer);

        this.rotationTimer = setInterval(() => {
            if (this.nodes.length <= 1) return;

            console.log("🔄 Rotating signaling node...");
            this.ws?.close(1000, "node rotation");

            // Select a different node
            const currentNode = this.nodes[this.currentNodeIndex];
            let newNode = this.selectNode();
            if (newNode === currentNode && this.nodes.length > 1) {
                const otherNodes = this.nodes.filter(n => n !== currentNode && n.healthy);
                if (otherNodes.length > 0) {
                    newNode = otherNodes[Math.floor(Math.random() * otherNodes.length)]!;
                }
            }

            this.connect();

            this.onEvent({
                t: "NODE_SWITCH",
                nodeId: newNode?.id || "unknown"
            });
        }, this.config.nodeRotationIntervalMs);
    }

    // ── Health Checks ─────────────────────────────────────────────────────

    private startHealthChecks() {
        if (this.healthCheckTimer) clearInterval(this.healthCheckTimer);

        this.healthCheckTimer = setInterval(async () => {
            for (const node of this.nodes) {
                if (node === this.nodes[this.currentNodeIndex]) continue; // Skip current

                try {
                    const start = performance.now();
                    // Simple HTTP health check (if endpoint available)
                    const httpUrl = node.url
                        .replace("wss:", "https:")
                        .replace("ws:", "http:")
                        .replace("/signaling", "/healthz");

                    const controller = new AbortController();
                    const timeout = setTimeout(() => controller.abort(), 5000);

                    const res = await fetch(httpUrl, { signal: controller.signal });
                    clearTimeout(timeout);

                    node.latencyMs = performance.now() - start;
                    node.healthy = res.ok;
                    node.lastChecked = Date.now();
                } catch {
                    node.latencyMs = Infinity;
                    node.lastChecked = Date.now();
                    // Don't mark as unhealthy from health check failure alone
                }
            }
        }, this.config.healthCheckIntervalMs);
    }

    // ── State Management ──────────────────────────────────────────────────

    private setState(state: SignalingState) {
        this.state = state;
        this.onStateChange?.(state);
    }

    getState(): SignalingState {
        return this.state;
    }

    getNodeInfo(): SignalingNode[] {
        return [...this.nodes];
    }

    getCurrentNode(): SignalingNode | null {
        return this.currentNodeIndex >= 0 ? this.nodes[this.currentNodeIndex] || null : null;
    }

    // ── Cleanup ───────────────────────────────────────────────────────────

    close() {
        this.destroyed = true;

        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        if (this.rotationTimer) clearInterval(this.rotationTimer);
        if (this.healthCheckTimer) clearInterval(this.healthCheckTimer);

        this.ws?.close(1000, "client disconnect");
        this.ws = null;
        this.messageQueue = [];
        this.setState("disconnected");
    }
}
