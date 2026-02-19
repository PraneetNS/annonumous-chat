"use client";

/**
 * 📡 SIGNALING CLIENT
 * 
 * Responsibilities:
 * - Handle the WebRTC "handshake" (Offer/Answer/ICE) via WebSocket.
 * - ZERO storage of peer data on server.
 * - Ephemeral room participation.
 */

export type SignalingEvent =
    | { t: "OFFER", from: string, sdp: RTCSessionDescriptionInit }
    | { t: "ANSWER", from: string, sdp: RTCSessionDescriptionInit }
    | { t: "ICE", from: string, candidate: RTCIceCandidateInit }
    | { t: "MATCH", roomId: string }
    | { t: "PUBKEY", jwk: JsonWebKey };

export class SignalingClient {
    private ws: WebSocket | null = null;
    private onEvent: (ev: SignalingEvent) => void;

    constructor(
        private url: string,
        private roomId: string,
        onEvent: (ev: SignalingEvent) => void,
        private onReady?: () => void
    ) {
        this.onEvent = onEvent;
    }

    connect() {
        this.ws = new WebSocket(this.url);

        this.ws.onopen = () => {
            // Join an ephemeral room strictly for signaling
            this.send({ t: "JOIN", roomId: this.roomId });
            if (this.onReady) this.onReady();
        };

        this.ws.onmessage = (e) => {
            try {
                const data = JSON.parse(e.data);
                this.onEvent(data);
            } catch (err) {
                console.error("Signaling parse error", err);
            }
        };
    }

    send(payload: any) {
        if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(payload));
        }
    }

    close() {
        this.ws?.close();
    }
}
