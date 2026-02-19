# 🚀 DIGITAL SHREDDER

### The Zero-Metadata, Anti-Forensic, P2P Ephemeral Communication Engine.

Digital Shredder is not a chat app. It is a communication **node** designed for high-risk environments where anonymity and metadata elimination are as important as message encryption.

---

## 🔐 Cryptographic Architecture

### 1. Ephemeral session Identity
- **Algorithm**: ECDH (Elliptic Curve Diffie-Hellman) over the **P-384** curve.
- **Persistence**: Zero. Keypairs are generated in-memory upon page load and are never stored in `localStorage`, `sessionStorage`, or `IndexedDB`.
- **Identity Hash**: Your "Username" is a SHA-256 fingerprint of your public key, regenerated every session.

### 2. P2P Mesh (WebRTC)
- **Encryption**: AES-256-GCM (Authenticated Encryption).
- **Transport**: WebRTC Data Channels. Signals are passed through a "blind" relay server that never sees the content.
- **Zero-Knowledge Relay**: Post-handshake, the server is out of the loop. Traffic flows directly between peers.

### 3. Metadata Camouflage
- **Padding**: Every message is padded to a fixed **4KB** block size to prevent traffic analysis through length observation.
- **Jitter**: High-entropy jitter is injected into packet timing to prevent temporal fingerprinting.
- **Noise**: The engine sends dummy encrypted packets at random intervals, making it impossible to tell when a human is actually communicating.

---

## 🛡️ Anti-Forensic Protection

- **The Eraser Module**: Hooks into browser `visibilitychange`, `blur`, and `unload` events.
- **Memory Scrambling**: Buffers are manually zeroed (`.fill(0)`) before they are released to the browser's Garbage Collector.
- **Panic Trigger**: `Ctrl+Shift+X` instantly nukes the session, wipes all keys, and redirects to `about:blank`.
- **Cache Elimination**: All service workers, storage APIs, and browser caching are disabled or bypassed.

---

## 🧠 Local AI Sensitivity Scanner
- **Privacy First**: Analysis happens 100% in-browser using Regex and Shannon Entropy analysis.
- **Data Leaks**: Detects Emails, Phone numbers, Crypto addresses, and high-entropy strings (passwords/keys) before they are encrypted and sent.

---

## ⚠️ Threat Model & Attack Surface

### What it PROTECTS against:
1.  **Server Seizure**: The signaling server has zero logs of who talked to whom and zero message content.
2.  **Network Surveillance**: ISP/State actors see normalized, jittered HTTPS traffic that looks like background noise.
3.  **Physical Device Forensic**: If the browser is closed or the tab minimized, keys are wiped from memory.

### What it DOES NOT protect against:
1.  **Screen Recording/Keyloggers**: If your device is already compromised by malware, it can see what you type.
2.  **State-Actor Level Traffic Temporal Analysis**: While jitter helps, a massive AI-driven analysis of global traffic patterns could still potentially correlate connections.
3.  **Browser Exploits**: Vulnerabilities in the Chrome/Firefox V8 engine could potentially leak memory before it is wiped.

---

## 🏗 Deployment instructions

### Local Development
```bash
npm install
npm run dev:all
```

### Production (Manual)
1.  Expose the signaling server via HTTPS (HTTPS is **REQUIRED** for WebCrypto).
2.  Use a STUN/TURN server for P2P connectivity across restricted NATs.

---

## 🛠 Future Research
- **VDF Time-Locks**: Integrating Verifiable Delay Functions for mathematical time-locked decryption.
- **Post-Quantum Crypto**: Transitioning to Kyber/Dilithium for PQC resistance.
- **steganographic fallbacks**: Hiding signaling data inside common image/pixel formats.

---

### 🚨 SECURITY WARNING 🚨
*This software is experimental. In high-risk situations, always combine Digital Shredder with a trusted VPN and a hardened OS (like Tails or Qubes OS). Use at your own risk.*
