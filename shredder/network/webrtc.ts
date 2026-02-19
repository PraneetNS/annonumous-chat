"use client";

import { wipe } from "../crypto/crypto";

/**
 * 🛰️ WEBRTC MESH - Peer-to-Peer Layer
 * 
 * Responsibilities:
 * - Establish P2P data channels.
 * - Manage peer connections.
 * - Handle ICE candidate exchange via signaling.
 */

export type PeerConfig = {
    iceServers: RTCIceServer[];
};

export class P2PPeer {
    private pc: RTCPeerConnection;
    private dc: RTCDataChannel | null = null;
    private onMessage: (msg: Uint8Array) => void;
    private iceQueue: RTCIceCandidateInit[] = [];

    constructor(
        config: PeerConfig,
        onMessage: (msg: Uint8Array) => void,
        private onIceCandidate: (candidate: RTCIceCandidate) => void,
        private onStateChange: (state: RTCPeerConnectionState) => void
    ) {
        this.pc = new RTCPeerConnection(config);
        this.onMessage = onMessage;

        this.pc.onicecandidate = (e: RTCPeerConnectionIceEvent) => {
            if (e.candidate) this.onIceCandidate(e.candidate);
        };

        this.pc.onconnectionstatechange = () => {
            this.onStateChange(this.pc.connectionState);
        };

        this.pc.ondatachannel = (e: RTCDataChannelEvent) => {
            this.setupDataChannel(e.channel);
        };
    }

    private setupDataChannel(channel: RTCDataChannel) {
        this.dc = channel;
        this.dc.binaryType = "arraybuffer";
        this.dc.onmessage = (e: MessageEvent) => {
            this.onMessage(new Uint8Array(e.data));
        };
        this.dc.onopen = () => console.log("🔒 P2P Data Channel Open");
        this.dc.onclose = () => console.log("❌ P2P Data Channel Closed");
    }

    async createOffer(): Promise<RTCSessionDescriptionInit> {
        const channel = this.pc.createDataChannel("shredder-chat", {
            ordered: true,
        });
        this.setupDataChannel(channel);
        const offer = await this.pc.createOffer();
        await this.pc.setLocalDescription(offer);
        return offer;
    }

    async handleOffer(offer: RTCSessionDescriptionInit): Promise<RTCSessionDescriptionInit> {
        await this.pc.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await this.pc.createAnswer();
        await this.pc.setLocalDescription(answer);
        await this.processIceQueue();
        return answer;
    }

    getSignalingState() {
        return this.pc.signalingState;
    }

    async handleAnswer(answer: RTCSessionDescriptionInit) {
        if (this.pc.signalingState !== "have-local-offer") return;
        await this.pc.setRemoteDescription(new RTCSessionDescription(answer));
        await this.processIceQueue();
    }

    async addCandidate(candidate: RTCIceCandidateInit) {
        if (this.pc.remoteDescription) {
            await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
        } else {
            this.iceQueue.push(candidate);
        }
    }

    private async processIceQueue() {
        while (this.iceQueue.length > 0) {
            const cand = this.iceQueue.shift();
            if (cand) await this.pc.addIceCandidate(new RTCIceCandidate(cand));
        }
    }

    send(data: Uint8Array) {
        if (this.dc && this.dc.readyState === "open") {
            this.dc.send(data as any);
        }
    }

    wipe() {
        this.dc?.close();
        this.pc.close();
        console.log("🧼 P2P Connection Purged");
    }
}
