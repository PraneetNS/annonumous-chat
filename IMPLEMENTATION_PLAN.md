# Implementation Plan - DIGITAL SHREDDER

A zero-metadata, anti-forensic, ephemeral communication engine.

## 🏗 Modular Architecture

### 1. `/lib/crypto` (The Cryptographic Core)
- **Engine**: Web Crypto API (SubtleCrypto).
- **Key Strategy**: ECDH (P-384) for key exchange + AES-GCM (256-bit) for message encryption.
- **Identity**: Session-based ephemeral keypairs. Identity = `SHA-256` hash of the public key.
- **Time-Lock**: Implementation of Shamir's Secret Sharing or time-hash chains for delayed decryption.
- **Memory Safety**: `Uint8Array.fill(0)` on all sensitive buffers before garbage collection.

### 2. `/lib/network` (WebRTC Mesh & Signaling)
- **Protocol**: `RTCPeerConnection` for P2P data channels.
- **Signaling**: Fastify + Socket.io (strictly for SDP/ICE exchange).
- **No-Log Relay**: Server acts as a "deaf" postman. Symmetric NAT support via STUN/TURN (shared credentials).
- **Camouflage**: Jitter injection in signaling and data channel heartbeat.

### 3. `/lib/security` (The Shield)
- **Traffic Hardening**: Message padding to fixed sizes (e.g., 4KB) to prevent traffic analysis.
- **Rate Limiting**: Token bucket at the signaling level.
- **Entropy Check**: Local-only analysis of message randomness patterns.

### 4. `/lib/anti-forensics` (The Eraser)
- **Global Wipe**: Hook into `visibilitychange`, `blur`, and `beforeunload`.
- **Memory Scrambling**: Use `FinalizationRegistry` and manual buffer nullification.
- **Storage Sanity**: Strict linting/testing to ensure `localStorage`, `sessionStorage`, and `IndexedDB` are never called.

### 5. `/lib/ai-scanner` (In-Browser DLP)
- **Local Model**: Lightweight regex-based entropy scanner + optional Transformer-lite (if overhead allows).
- **Detection**: PII (Emails, Phones), Financials, and Geo-coordinates.

### 6. `/ui` & `/audit` (Frontend)
- **Glassmorphism Design**: High-end, premium aesthetic.
- **Security Audit Panel**: Real-time HUD showing crypto state and "Proof of Zero-Knowledge".
- **Panic UI**: High-contrast emergency buttons.

---

## 📅 Phased Roadmap

### Phase 1: The Core Refactor
- [ ] Rewire `lib/crypto.ts` for strictly ephemeral session keys and memory wiping.
- [ ] Implement `lib/anti-forensics.ts` with global listeners.
- [ ] Strip current Redis storage of anything related to "Room State" beyond minimal signaling.

### Phase 2: WebRTC Mesh implementation
- [ ] Replace WebSocket relay with WebRTC signaling.
- [ ] Implement `lib/network` for peer-to-peer data channels.

### Phase 3: Advanced Features
- [ ] Metadata Camouflage (Randomized Padding & Timing).
- [ ] Local AI Sensitivity Scanner.
- [ ] Time-Locked Decryption module.

### Phase 4: Audit & Polish
- [ ] Create the Security Audit Panel.
- [ ] Implement Low Bandwidth / 2G mode.
- [ ] Final security audit and README (Attack Surface Analysis).
