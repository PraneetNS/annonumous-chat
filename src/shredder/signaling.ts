import type { FastifyInstance } from "fastify";
import type { WebSocket, RawData } from "ws";
import { randomIdB64Url } from "../utils/base64url.js";

/**
 * 🛰️ MINIMAL SIGNALING SERVER - No Logs, No Storage
 * 
 * Responsibilities:
 * - Simple relay of WebRTC offers/answers/ICE.
 * - Ephemeral memory-only room state.
 * - ZERO persistence.
 */

const rooms = new Map<string, Set<WebSocket>>();
const waitingPeers = new Set<WebSocket>();

export function registerSignaling(fastify: FastifyInstance) {
    fastify.get("/signaling", { websocket: true }, (socket: WebSocket, req) => {
        let currentRoomId: string | null = null;

        socket.on("message", (data: RawData) => {
            try {
                const msg = JSON.parse(data.toString());

                switch (msg.t) {
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

                    case "JOIN": {
                        const { roomId } = msg;
                        if (!roomId) return;
                        currentRoomId = roomId;
                        waitingPeers.delete(socket); // Remove from random pool if they join specific room

                        if (!rooms.has(roomId)) {
                            rooms.set(roomId, new Set());
                        }
                        rooms.get(roomId)?.add(socket);

                        // Limit rooms to 2 peers for privacy and performance (except for LOBBY matcher)
                        if (roomId !== "LOBBY" && (rooms.get(roomId)?.size || 0) > 2) {
                            socket.send(JSON.stringify({ t: "ERROR", code: "ROOM_FULL" }));
                            socket.close();
                            return;
                        }
                        break;
                    }

                    default: {
                        // Relay everything else to peers in the same room
                        if (!currentRoomId) return;
                        const peers = rooms.get(currentRoomId);
                        if (!peers) return;

                        const payload = JSON.stringify(msg);
                        for (const peer of peers) {
                            if (peer !== socket && peer.readyState === 1 /* OPEN */) {
                                peer.send(payload);
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
            if (currentRoomId) {
                const peers = rooms.get(currentRoomId);
                peers?.delete(socket);
                if (peers?.size === 0) {
                    rooms.delete(currentRoomId);
                }
            }
        };

        socket.on("close", cleanup);
        socket.on("error", cleanup);
    });
}
