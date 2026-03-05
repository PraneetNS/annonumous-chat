import type { FastifyInstance } from "fastify";
import type { WebSocket, RawData } from "ws";
import { randomIdB64Url } from "../utils/base64url.js";

/**
 * 🛰️ DISTRIBUTED SIGNALING SERVER - Multi-Peer Mesh Support
 * 
 * Upgraded from 2-peer rooms to 10-peer mesh topology.
 * 
 * Responsibilities:
 * - Relay WebRTC offers/answers/ICE between mesh peers
 * - Ephemeral memory-only room state (ZERO persistence)
 * - Multi-peer room management (up to 10 peers per room)
 * - Peer discovery and notification
 * - Random stranger matching
 * - PQC key bundle exchange
 * - Room auto-cleanup when empty
 * 
 * Security:
 * - No message logging
 * - No persistent storage
 * - All state is in-memory only
 * - Rooms deleted when last peer leaves
 */

const MAX_PEERS_PER_ROOM = 10;

interface PeerConnection {
    socket: WebSocket;
    peerId: string;
    fingerprint: string;
    joinedAt: number;
}

interface Room {
    roomId: string;
    peers: Map<string, PeerConnection>;
    createdAt: number;
}

const rooms = new Map<string, Room>();
const waitingPeers = new Set<WebSocket>();
const socketToPeer = new Map<WebSocket, { peerId: string; roomId: string | null }>();

function generatePeerId(): string {
    return randomIdB64Url(12);
}

export function registerSignaling(fastify: FastifyInstance) {
    // Periodic cleanup of stale rooms (safety net)
    const cleanupInterval = setInterval(() => {
        const now = Date.now();
        const MAX_ROOM_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours max

        for (const [roomId, room] of rooms) {
            // Remove rooms older than MAX_ROOM_AGE_MS with no peers
            if (room.peers.size === 0 || (now - room.createdAt > MAX_ROOM_AGE_MS)) {
                rooms.delete(roomId);
            }
        }
    }, 60_000).unref();

    fastify.addHook("onClose", async () => {
        clearInterval(cleanupInterval);
    });

    fastify.get("/signaling", { websocket: true }, (socket: WebSocket, req) => {
        const localPeerId = generatePeerId();
        let currentRoomId: string | null = null;

        socketToPeer.set(socket, { peerId: localPeerId, roomId: null });

        socket.on("message", (data: RawData) => {
            try {
                const msg = JSON.parse(data.toString());

                switch (msg.t) {
                    // ── Random Stranger Matching ──────────────────────────
                    case "RANDOM": {
                        if (waitingPeers.size > 0) {
                            const peer = waitingPeers.values().next().value;
                            if (!peer) return;
                            waitingPeers.delete(peer);
                            const roomId = `random-${randomIdB64Url(8)}`;

                            const matchMsg = JSON.stringify({ t: "MATCH", roomId });
                            peer.send(matchMsg);
                            socket.send(matchMsg);
                        } else {
                            waitingPeers.add(socket);
                        }
                        break;
                    }

                    // ── Room Join (Multi-Peer Mesh) ──────────────────────
                    case "JOIN": {
                        const { roomId } = msg;
                        if (!roomId) return;

                        currentRoomId = roomId;
                        waitingPeers.delete(socket);
                        socketToPeer.set(socket, { peerId: localPeerId, roomId });

                        if (!rooms.has(roomId)) {
                            rooms.set(roomId, {
                                roomId,
                                peers: new Map(),
                                createdAt: Date.now()
                            });
                        }

                        const room = rooms.get(roomId)!;

                        // Check room capacity
                        if (room.peers.size >= MAX_PEERS_PER_ROOM) {
                            socket.send(JSON.stringify({ t: "ERROR", code: "ROOM_FULL" }));
                            return;
                        }

                        // Get existing peer list before adding new peer
                        const existingPeerIds = Array.from(room.peers.keys());
                        const existingFingerprints = Array.from(room.peers.values()).map(p => ({
                            peerId: p.peerId,
                            fingerprint: p.fingerprint
                        }));

                        // Add new peer to room
                        const fingerprint = msg.fingerprint || localPeerId.slice(0, 16);
                        room.peers.set(localPeerId, {
                            socket,
                            peerId: localPeerId,
                            fingerprint,
                            joinedAt: Date.now()
                        });

                        // Send room info to the new peer (existing peers list)
                        socket.send(JSON.stringify({
                            t: "ROOM_INFO",
                            roomId,
                            peers: existingPeerIds,
                            peerDetails: existingFingerprints,
                            yourPeerId: localPeerId
                        }));

                        // Notify existing peers about the new peer
                        const joinMsg = JSON.stringify({
                            t: "PEER_JOIN",
                            peerId: localPeerId,
                            fingerprint
                        });

                        for (const [pid, peerConn] of room.peers) {
                            if (pid !== localPeerId && peerConn.socket.readyState === 1) {
                                peerConn.socket.send(joinMsg);
                            }
                        }

                        break;
                    }

                    // ── Mesh Offer (Targeted) ────────────────────────────
                    case "MESH_OFFER": {
                        if (!currentRoomId) return;
                        const room = rooms.get(currentRoomId);
                        if (!room) return;

                        const targetPeer = room.peers.get(msg.targetPeerId);
                        if (targetPeer && targetPeer.socket.readyState === 1) {
                            targetPeer.socket.send(JSON.stringify({
                                ...msg,
                                peerId: localPeerId
                            }));
                        }
                        break;
                    }

                    // ── Mesh Answer (Targeted) ───────────────────────────
                    case "MESH_ANSWER": {
                        if (!currentRoomId) return;
                        const room = rooms.get(currentRoomId);
                        if (!room) return;

                        const targetPeer = room.peers.get(msg.targetPeerId);
                        if (targetPeer && targetPeer.socket.readyState === 1) {
                            targetPeer.socket.send(JSON.stringify({
                                ...msg,
                                peerId: localPeerId
                            }));
                        }
                        break;
                    }

                    // ── Mesh ICE Candidate (Targeted) ────────────────────
                    case "MESH_ICE": {
                        if (!currentRoomId) return;
                        const room = rooms.get(currentRoomId);
                        if (!room) return;

                        const targetPeer = room.peers.get(msg.targetPeerId);
                        if (targetPeer && targetPeer.socket.readyState === 1) {
                            targetPeer.socket.send(JSON.stringify({
                                ...msg,
                                peerId: localPeerId
                            }));
                        }
                        break;
                    }

                    // ── PQC Bundle Exchange ──────────────────────────────
                    case "PQC_BUNDLE": {
                        if (!currentRoomId) return;
                        const room = rooms.get(currentRoomId);
                        if (!room) return;

                        // Broadcast PQC bundle to all peers in room
                        const payload = JSON.stringify({
                            t: "PQC_BUNDLE",
                            from: localPeerId,
                            bundle: msg.bundle
                        });

                        for (const [pid, peerConn] of room.peers) {
                            if (pid !== localPeerId && peerConn.socket.readyState === 1) {
                                peerConn.socket.send(payload);
                            }
                        }
                        break;
                    }

                    // ── Legacy Signaling (backward compatible) ────────────
                    default: {
                        if (!currentRoomId) return;
                        const room = rooms.get(currentRoomId);
                        if (!room) return;

                        // Relay to all other peers in room
                        const payload = JSON.stringify(msg);
                        for (const [pid, peerConn] of room.peers) {
                            if (pid !== localPeerId && peerConn.socket.readyState === 1) {
                                peerConn.socket.send(payload);
                            }
                        }
                    }
                }
            } catch (err) {
                // Silent fail on invalid messages - anti-probing
            }
        });

        const cleanup = () => {
            waitingPeers.delete(socket);
            socketToPeer.delete(socket);

            if (currentRoomId) {
                const room = rooms.get(currentRoomId);
                if (room) {
                    room.peers.delete(localPeerId);

                    // Notify remaining peers
                    const leaveMsg = JSON.stringify({
                        t: "PEER_LEAVE",
                        peerId: localPeerId
                    });
                    for (const [, peerConn] of room.peers) {
                        if (peerConn.socket.readyState === 1) {
                            peerConn.socket.send(leaveMsg);
                        }
                    }

                    // Auto-delete room when empty (no server persistence)
                    if (room.peers.size === 0) {
                        rooms.delete(currentRoomId);
                    }
                }
            }
        };

        socket.on("close", cleanup);
        socket.on("error", cleanup);
    });
}
