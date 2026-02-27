### 1. Project Overview

- **What this project is**: A security-focused communication engine that supports (a) an **E2EE room chat** over a **blind WebSocket relay** and (b) a **P2P WebRTC “GhostWire” mode** with **ECDH key exchange**, **traffic-camouflage**, and **anti-forensic session wiping**.
- **One-line elevator pitch**: **Ephemeral, end-to-end encrypted communication where the server is a minimal relay and the client aggressively minimizes metadata and memory residue.**
- **Problem statement**: Traditional web chat systems centralize trust in the server, store message data (or can be compelled to), and leak metadata (room membership, timing, identifiers). This project tries to **reduce server knowledge** and **limit forensic traces** on the client.
- **Why this project exists**: To explore a pragmatic “high-risk comms” architecture that combines:
  - Blind relaying (server never sees plaintext)
  - Ephemeral identities/keys
  - Strong “panic wipe” UX
  - Anti-traffic-analysis ideas (padding, jitter, noise)
- **Target users**:
  - Security-minded teams demoing E2EE concepts
  - Interview/demo audiences evaluating system design and security engineering
  - Developers who want an “ephemeral comms” reference implementation
- **Real-world use case**:
  - Temporary coordination during incident response
  - Anonymous, time-bounded collaboration with no message persistence
  - Field testing E2EE + anti-forensics UI patterns

---

### 2. Core Problem It Solves

#### What was broken before this?
- **Server trust and retention**: Common chat apps store messages or have access to plaintext (or to keys).
- **Metadata leakage**: Even if content is encrypted, typical systems still reveal: who connected, room membership, message size, timing, and IP-derived patterns.
- **Client forensic residue**: Browsers cache, retain BFCache snapshots, or keep secrets alive in memory longer than expected.

#### Why existing solutions are insufficient?
- Many “encrypted chats” stop at content encryption and don’t address:
  - **Join-token replay** and room abuse
  - **Traffic analysis** (size/timing correlation)
  - **Operational hardening** (rate limits, slow-consumer protection)
  - **Forensic UX** (panic button, wipe-on-unload)

#### What gap does this fill?
- A single repo that demonstrates:
  - A production-ish WebSocket relay with **Redis-backed ephemeral room state**
  - A P2P WebRTC mode with **ECDH P-384 + AES-GCM**
  - Anti-forensics primitives (wipe registry + BFCache defense)
  - “Privacy guard” scanning before sending sensitive strings

---

### 3. System Architecture

#### High-level architecture explanation
This repository implements **two parallel communication paths**:

1) **WS-Relay Room Chat (multi-participant)**  
Client encrypts payload with a symmetric room secret → sends ciphertext over WebSocket → server blindly broadcasts ciphertext to room members. Redis stores only room membership/count/TTL (no messages).

2) **GhostWire WebRTC P2P (two peers)**  
Peers generate ephemeral ECDH keys → exchange public keys + SDP/ICE via signaling WS → derive a shared AES-GCM key → exchange encrypted data directly via WebRTC data channel, with optional padding/jitter/noise.

#### Backend architecture
- **Runtime**: Node.js (TypeScript), Fastify + `@fastify/websocket`
- **Core responsibilities**:
  - `/ws`: WebSocket room relay (blind fanout)
  - `/rooms` + `/rooms/:roomId/token`: room creation + join token minting
  - `/signaling`: minimal WebRTC signaling relay (memory-only rooms)
  - Health/metrics endpoints (aggregate-only)
- **State**:
  - Redis (rooms, counts, replay-protection JTIs)
  - In-process maps for current WS connections and local room routing

#### Frontend architecture
- **Runtime**: Next.js App Router
- **Paths**:
  - `app/page.tsx`: GhostWire mode (WebRTC + ECDH + camouflage + anti-forensics UI)
  - `app/join/*` and `app/chat/*`: WS-relay mode (AES-GCM using URL-hash secret)
- **Key modules**:
  - `lib/crypto.ts`: AES-GCM E2EE for WS-relay chat + encrypted media chunking
  - `shredder/crypto/crypto.ts`: ECDH P-384 + AES-GCM with 4KB padding
  - `shredder/security/camouflage.ts`: jitter + noise packet scheduling
  - `shredder/anti-forensics/eraser.ts`: wipe registry + panic triggers
  - `shredder/ai-scanner/scanner.ts`: local PII/entropy scanner

#### Database architecture
- **Redis** is used as an **ephemeral state store**, not a durable database:
  - Room membership sets + participant count
  - TTL-based cleanup (keys auto-expire)
  - Join-token replay resistance via JTI “used” markers
- **No message persistence**: ciphertext is relayed; content is never stored.

#### AI/ML architecture (if applicable)
- No model inference, training, or remote calls.
- “AI scanner” is a **local pattern/entropy heuristic** (regex + Shannon entropy), intentionally offline.

#### Deployment architecture
- **Local dev**: `npm run dev:all` runs backend + Next dev + unified proxy + Cloudflare tunnel manager.
- **Docker**: multi-stage Dockerfile builds `dist/` for backend; `docker-compose.yml` includes Redis.
- **Public access**: `scripts/tunnel-manager.js` starts a **Cloudflare Quick Tunnel** to the unified proxy.

#### Communication flow between components

**WS-Relay Mode**

```
Browser (Next.js)
  ├─ HTTPS (rewrites) /api/*  ───────────────▶ Fastify (port 3001)
  └─ WSS /ws (rewrites or proxy) ───────────▶ Fastify WS handler
                           │
                           └─ Redis: room state + token replay JTIs
```

**GhostWire P2P Mode**

```
Browser A ── WSS /signaling ──┐
                              ├─ Fastify signaling relay (no persistence)
Browser B ── WSS /signaling ──┘

Browser A ◀──────── WebRTC DataChannel (P2P) ────────▶ Browser B
      (AES-GCM with ECDH-derived key + padding/jitter/noise)
```

#### Request-response lifecycle

**WS-Relay Mode lifecycle**
- Create room:
  - Client → `POST /api/rooms` → server creates empty room in Redis (TTL) and returns roomId + fingerprint + network IP.
- Join room:
  - Client → `GET /api/rooms/:roomId/token` → server mints HMAC join token with expiry + random JTI.
  - Client opens `WSS /ws` and sends `JOIN_REQUEST` containing token.
  - Server validates token, checks replay (Redis NX key), then adds connection to room membership and begins blind relay.
- Send message:
  - Client encrypts JSON → sends `APP_MSG` with `ciphertextB64`.
  - Server broadcasts ciphertext to room; never inspects payload.

**GhostWire Mode lifecycle**
- Session init:
  - Client generates ephemeral ECDH keypair and identity fingerprint (SHA-256 of public key).
- Signaling:
  - Client connects to `WSS /signaling`, joins a room, and exchanges OFFER/ANSWER/ICE.
  - Clients exchange ECDH public keys (`PUBKEY`) via the same signaling channel.
- P2P:
  - Both derive shared AES-GCM key; send encrypted, padded messages over WebRTC DataChannel.
  - Camouflage engine optionally schedules sends and injects “noise” packets.

#### Data flow: User → Frontend → Backend → Database → Model → Response → UI

- **User**: types a message / selects an image.
- **Frontend**:
  - Scans for sensitive patterns (GhostWire).
  - Encrypts payload locally (AES-GCM; key either URL-hash secret (WS) or ECDH-derived (P2P)).
- **Backend**:
  - **WS mode**: validates join tokens + rate limits; relays ciphertext; updates room state in Redis.
  - **GhostWire**: relays signaling only; no cryptographic material stored.
- **Database (Redis)**:
  - Stores room membership/count + TTL
  - Stores JTI markers for replay resistance
- **Model**: N/A (no ML model).
- **Response**:
  - Encrypted payload delivered to other clients (WS broadcast or WebRTC direct).
  - Recipients decrypt locally and render in UI.

---

### 4. Technology Stack

#### Frontend stack
- **Next.js (App Router)**:
  - **Why chosen**: fast prototyping, routing, easy deployment, modern React.
  - **Alternatives**: Vite + React Router; Remix; SvelteKit.
  - **Tradeoffs**: dev-mode double-invocations (handled by disabling strict mode), more complexity than a thin SPA.
- **React**:
  - **Why**: mature ecosystem; quick UI iteration.
  - **Tradeoffs**: client-side crypto flows require careful lifecycle handling to avoid leaking secrets.

#### Backend stack
- **Fastify**:
  - **Why**: high-performance Node server, clean plugin model, good WS integration.
  - **Alternatives**: Express + ws; uWebSockets.js; Go (Fiber/Gin).
  - **Tradeoffs**: requires deliberate safety defaults (redaction, limits), which this repo adds.
- **`@fastify/websocket` + `ws`**:
  - **Why**: straight-through WebSocket handling for relay/signaling.
  - **Tradeoffs**: single-node fanout limits; needs careful backpressure handling (implemented via bufferedAmount checks + chunked broadcast).

#### Database
- **Redis (ioredis)**:
  - **Why**: fast in-memory state, TTL semantics, atomic ops (Lua, NX keys).
  - **Alternatives**: in-memory only (no horizontal scaling), Postgres (overkill), DynamoDB (cost/latency).
  - **Tradeoffs**: introduces an operational dependency; must avoid persistence for threat model consistency (deployment docs mention this).

#### AI/ML frameworks
- None. “AI scanner” is a local heuristic module.

#### DevOps / tooling
- **Docker + docker-compose**: production-ish packaging for backend + Redis.
- **PM2 config**: suggested for multi-process clustering (with caveats for WS stickiness).
- **Cloudflare Quick Tunnel (`cloudflared`)**:
  - **Why**: frictionless sharing of HTTPS endpoint for WebCrypto / mobile.
  - **Alternatives**: ngrok; localtunnel; Tailscale Funnel; reverse proxy + DNS.
  - **Tradeoffs**: quick tunnels are not stable domains; production needs a managed tunnel + auth.

#### APIs used
- **WebCrypto**: AES-GCM, SHA-256, ECDH P-384 (GhostWire).
- **WebRTC**: RTCPeerConnection + RTCDataChannel (GhostWire).
- **WebSocket**: relay and signaling channels.

---

### 5. Folder Structure Breakdown

- **`app/`**: Next.js App Router pages.
  - `app/page.tsx`: GhostWire UI (P2P WebRTC).
  - `app/join/*`, `app/chat/*`: WS-relay UI (room join, chat).
- **`components/`**:
  - `PanicManager.tsx`: panic wipe UI + wiring.
- **`lib/`**:
  - `crypto.ts`: symmetric E2EE for WS-relay mode (AES-GCM) + media encryption/chunking.
- **`src/`**: Fastify backend (TypeScript).
  - `server.ts`: server construction, middleware, endpoints registration.
  - `ws/*`: WebSocket relay protocol + fanout.
  - `rooms/*`: Redis room store.
  - `security/*`: join tokens, rate limiting.
  - `shredder/signaling.ts`: signaling WS endpoint for WebRTC.
  - `observability/*`: safe metrics + health checks.
- **`server/`**: backend source (older/parallel) and `certs/` for local HTTPS.
- **`scripts/`**:
  - `unified-proxy.js`: single entrypoint proxy for `/api` + `/ws` + frontend.
  - `tunnel-manager.js`: Cloudflare quick tunnel URL discovery and persistence.
  - `start-redis.js`: local Redis helper.
- **`dist/`**: compiled backend output (production runtime artifact).
- **`shredder/`**: “high-risk comms engine” client modules (crypto, webrtc, anti-forensics, scanner, UI audit panel).

**Design pattern**:
- Backend resembles a pragmatic **modular service** style (Fastify “plugin-ish” modules + single `buildServer()` composition).
- Frontend is **feature-module oriented** (GhostWire under `shredder/`, WS-relay under `lib/` and route-level components).

---

### 6. Key Features Deep Dive

#### Feature: WebSocket relay E2EE room chat
- **What it does**: Multi-participant chat where server relays ciphertext.
- **How it works**:
  - Client derives/imports a symmetric room key (passed via URL hash `#k=...`).
  - Client encrypts chat JSON via AES-GCM (`lib/crypto.ts`) and sends `APP_MSG`.
  - Server validates membership and broadcasts ciphertext to all connections in the room.
- **Important modules**:
  - Frontend: `app/chat/ChatClient.tsx`, `lib/crypto.ts`
  - Backend: `src/ws/handlers.ts`, `src/rooms/roomStore.ts`
- **Edge cases handled**:
  - Rate limits (token buckets), max payload sizes, slow consumer disconnects
  - Token replay protection using Redis NX keys
  - Keepalive pings to detect dead WS connections

#### Feature: Join tokens + replay protection
- **What it does**: Prevents guessing/joining rooms without capability; limits replay.
- **How it works**:
  - Join token payload includes roomId, expiry, JTI; HMAC protects integrity.
  - On join, server checks HMAC then marks JTI as used with TTL so replays are rejected.
- **Tradeoff**: Still does not authenticate real identity—only capability possession.

#### Feature: WebRTC P2P GhostWire mode
- **What it does**: Two peers chat via direct WebRTC data channel once connected.
- **How it works**:
  - Signaling WS exchanges SDP/ICE and ECDH public keys.
  - Clients derive a shared AES-GCM key and encrypt padded payloads.
- **Important modules**:
  - `shredder/network/webrtc.ts` (P2P layer)
  - `shredder/network/signaling-client.ts` + `src/shredder/signaling.ts` (signaling)
  - `shredder/crypto/crypto.ts` (ECDH + AES-GCM + padding)
- **Edge cases**:
  - Offer collision resolution (identity hash tie-breaker)
  - Waiting room matching for “stranger chat”
  - Room capacity capped to 2 peers (privacy/perf)

#### Feature: Metadata camouflage (padding, jitter, noise)
- **What it does**: Makes passive analysis harder by smoothing size/timing signals.
- **How it works**:
  - Crypto layer pads plaintext to 4KB multiples before encryption (GhostWire).
  - Camouflage engine introduces random send jitter and background noise packets.
- **Tradeoff**: Increases bandwidth + latency; not a complete defense against global correlation.

#### Feature: Anti-forensic wipe + panic UX
- **What it does**: Attempts to minimize secrets lingering in memory and reduce BFCache risks.
- **How it works**:
  - Components register wipeable objects.
  - Wipe triggers: unload, optional blur/minimize, and `Ctrl+Shift+X` hotkey.
  - Redirect to `about:blank` to drop the JS heap.
- **Tradeoff**: Browser/runtime cannot guarantee immediate memory eviction; this is “best-effort” hygiene.

#### Feature: Local sensitivity scanner
- **What it does**: Warns when user types likely PII or high-entropy secrets.
- **How it works**:
  - Regex detection (emails/phones/cards/crypto/IP) and entropy check.
  - Runs fully offline; no telemetry.
- **Tradeoff**: False positives/negatives; not ML; attackers can evade patterns.

#### Feature: Time-locked payloads (UX-level)
- **What it does**: Represents messages that should “unlock” at a future time.
- **How it works**:
  - Metadata includes `releaseAt`; client checks readiness before rendering.
- **Tradeoff**: Not a true cryptographic time-lock (no VDF/TEEs); it’s a UX contract.

---

### 7. How It Was Built (Step-by-Step)

- **Initial idea**: Build an “ephemeral chat” where content is always client-encrypted and the server is a dumb relay.
- **MVP version**:
  - WS relay + Redis room store + join tokens
  - Basic Next.js UI for creating/joining rooms
- **Iterations**:
  - Added hardening: rate limits, ping keepalive, slow-consumer protection
  - Added safe metrics/health endpoints (aggregate only)
  - Added “Digital Shredder” layer (anti-forensics, scanner, camouflage)
  - Added WebRTC P2P GhostWire mode with signaling
- **Major technical challenges**:
  - WebCrypto secure-context constraints → enforced HTTPS/proxy/tunnel tooling
  - Managing WS backpressure and large rooms without event loop stalls
  - Token replay protection without storing user identity
- **Debugging strategies**:
  - Audit panel logs (GhostWire)
  - Health endpoints + metrics counters
  - Structured logging with redaction
- **Architectural evolution**:
  - Started as a single relay system → expanded into two-mode engine (relay + P2P).

---

### 8. AI/ML Logic (If Applicable)

- **Model used**: None.
- **What exists instead**: Local “sensitivity scanning” heuristics:
  - Regex patterns for PII-like strings
  - Shannon entropy heuristic to flag possible secrets
- **Why this approach**:
  - Zero network calls, no data leakage, no model distribution complexity.
- **Limitations**:
  - Not robust against adversarial input
  - Not language-aware; limited pattern set

---

### 9. Security Considerations

#### Authentication mechanism
- **Capability-based access**:
  - WS rooms use HMAC-signed join tokens (room capability) + short expiry.
  - GhostWire “rooms” are essentially shared roomIds; security depends on who knows the roomId.

#### Authorization
- Membership checks are enforced server-side for relay broadcasting (room membership tracked in Redis + in-process maps).

#### Data protection
- **Content E2EE**:
  - WS mode: AES-GCM with symmetric key from URL hash secret (`lib/crypto.ts`).
  - GhostWire: ECDH P-384 derived AES-GCM key (`shredder/crypto/crypto.ts`).
- **At rest**:
  - Redis stores membership + JTIs, no messages.

#### Secrets management
- `JOIN_TOKEN_SECRET` must be strong and rotated (deployment doc guidance).
- Avoid committing `.env` with real secrets.

#### API security
- Size limits, rate limits, replay protection, slow-consumer protection.
- Security headers + CORS toggles configurable via env.

#### Production hardening
- Trust proxy settings to be correct behind load balancers.
- Use WAF/DDoS protection in front of WS endpoints.
- Enforce TLS and disable detailed errors in production.

---

### 10. Performance Optimization

- **Caching**:
  - Redis TTL-based ephemeral keys prevent unbounded growth.
- **Async handling**:
  - WS broadcast uses chunked sending with `setImmediate` to avoid blocking the event loop.
- **Database indexing**:
  - Not applicable (Redis key-value).
- **Scaling strategy**:
  - WS relay is stateful per connection; requires sticky sessions or a WS-aware LB.
  - Redis is a shared state store for rooms/replay markers.
- **Backpressure**:
  - Drop/disconnect slow consumers based on `bufferedAmount` thresholds.

---

### 11. Scalability

#### Horizontal scaling
- Requires:
  - Sticky sessions for WebSocket connections (or a shared pub/sub fanout layer).
  - Redis remains shared for room membership/replay.
- For large scale, consider:
  - Redis Pub/Sub or NATS for cross-instance fanout.
  - Sharding rooms across relay nodes.

#### Vertical scaling
- Works up to the point where a single Node process can handle WS fanout and crypto overhead (crypto mostly on clients).

#### Load balancing
- Must support WebSocket upgrades and long-lived connections.
- Configure timeouts and connection draining for rolling deploys.

#### Containerization
- Backend is container-ready with multi-stage build; compose includes Redis.

#### Microservices potential
- Could separate:
  - Signaling service (stateless, in-memory rooms)
  - Relay service (WS rooms)
  - Token minting API
But doing so increases metadata risk unless carefully designed.

#### Future distributed system design
- Evented “room bus” + edge relays + TURN infrastructure for WebRTC.

---

### 12. Deployment Strategy

#### Local development setup
- Install deps: `npm install`
- Start Redis: `node scripts/start-redis.js` (or Docker Redis)
- Run everything: `npm run dev:all`
  - Backend WS/HTTPS
  - Next dev
  - Unified proxy (single ingress)
  - Cloudflare quick tunnel (public HTTPS URL)

#### Production deployment
- Backend can be deployed via Docker or PM2.
- Put behind a reverse proxy / load balancer with TLS termination.
- For GhostWire: you must expose `/signaling` as WSS and allow WebRTC ICE/UDP flows (via STUN/TURN).

#### CI/CD
- Recommended:
  - Lint/typecheck + build
  - Container build + vulnerability scan
  - Deploy with canary + health checks

#### Environment variables
- `REDIS_URL`, `JOIN_TOKEN_SECRET`, CORS/CSP toggles, rate limits, feature toggles.

#### Monitoring and logging
- Health endpoints: `/health`, `/ready`, `/live`, `/metrics`
- Metrics are aggregate-only to maintain E2EE guarantees.

---

### 13. Value Proposition

- **Business value**:
  - Demonstrates a credible security-first comms story: “server can’t read messages; minimal metadata.”
  - Useful for demos, security posture discussions, and threat-model walkthroughs.
- **Technical value**:
  - Reference patterns: join capability tokens + replay resistance, WS backpressure handling, client-side crypto hygiene, WebRTC signaling minimalism.
- **Competitive advantage**:
  - Dual-mode architecture: relay for simplicity + P2P for stronger trust minimization.
  - Anti-forensics UX elements (panic wipe, BFCache defenses).
- **ROI impact**:
  - Low operational costs for MVP (Redis + Node) while enabling strong differentiation on security narrative.

---

### 14. Possible Demo Questions & Answers

#### 30 tough technical questions
1. **Q**: How do you ensure the server never sees plaintext?  
   **A**: Clients encrypt before send (AES-GCM). Server only routes ciphertext and enforces admission/rate limits; it never parses message bodies.
2. **Q**: Why AES-GCM?  
   **A**: AEAD provides confidentiality + integrity; widely supported by WebCrypto; efficient in browsers.
3. **Q**: What prevents token forgery?  
   **A**: Join tokens are HMAC-SHA256 signed with `JOIN_TOKEN_SECRET`; verification is timing-safe.
4. **Q**: What prevents token replay?  
   **A**: JTI (unique id) is marked “used” in Redis via NX+PX; replays are rejected until expiry.
5. **Q**: If you scale to multiple backend instances, does replay protection still work?  
   **A**: Yes if all instances share Redis; JTI NX check remains global.
6. **Q**: How do you handle WS backpressure?  
   **A**: Check `bufferedAmount`, drop/close slow consumers, and broadcast in chunks with `setImmediate`.
7. **Q**: What happens when Redis is down?  
   **A**: Backend startup fails initial ping; health endpoints reflect failure; room joins/creates can’t proceed safely.
8. **Q**: Why store participant counts separately from set size?  
   **A**: Atomicity/performance; Lua scripts manage count updates and capacity checks without expensive SMEMBERS.
9. **Q**: How do you avoid leaking IP addresses via metrics?  
   **A**: Metrics collector stores only aggregate counters/gauges and avoids IP labels.
10. **Q**: What is the threat model for GhostWire signaling server?  
    **A**: It’s a relay for SDP/ICE/public keys only; it can observe metadata but does not store it; P2P content remains encrypted.
11. **Q**: Can signaling server MITM the ECDH exchange?  
    **A**: Without authenticated key verification, yes—signaling can substitute keys. Production needs identity verification (QR fingerprint, out-of-band).
12. **Q**: Why P-384 instead of X25519?  
    **A**: WebCrypto widely supports P-256/P-384; X25519 support varies. Tradeoff: performance and modern preference for X25519.
13. **Q**: Why disable React strict mode?  
    **A**: Strict mode can double-invoke effects in dev, causing duplicate WS connections/handshakes.
14. **Q**: How does padding help against traffic analysis?  
    **A**: Normalizes message sizes to reduce size-based inference; still not a complete solution.
15. **Q**: Why add noise packets?  
    **A**: Makes timing analysis noisier; increases ambiguity of “real message vs idle.”
16. **Q**: What’s the max message size and why?  
    **A**: Configurable; WS path caps payload and app ciphertext; media path chunks to manage size and memory pressure.
17. **Q**: How do you prevent memory leaks in rooms?  
    **A**: Redis TTL cleanup + in-process cleanup when empty; periodic ping timers are `unref()`’d.
18. **Q**: How do you handle dead WS clients?  
    **A**: Server pings; if no pong within timeout, terminates connection.
19. **Q**: Can clients impersonate labels?  
    **A**: Labels are not authenticated; they’re UX-only. Identity binding would require signed assertions.
20. **Q**: Why use Redis at all—could be in-memory?  
    **A**: Redis enables multi-instance scaling and TTL-based cleanup; in-memory only breaks on restarts and can’t scale.
21. **Q**: What’s the failure mode if a client loses its URL-hash secret?  
    **A**: It can’t decrypt; messages remain opaque; the client should treat it as unrecoverable.
22. **Q**: Does E2EE guarantee anonymity?  
    **A**: No. It protects content, not metadata. This repo includes mitigation attempts, not guarantees.
23. **Q**: How do you deal with TURN requirements for WebRTC?  
    **A**: Current config uses public STUN; production needs TURN to handle restrictive NATs/firewalls.
24. **Q**: Is the time-lock feature cryptographically enforced?  
    **A**: No; it’s metadata-enforced UX. True time-lock needs VDF/trusted beacon/TEE.
25. **Q**: What’s the weakest security link?  
    **A**: Key authentication (MITM risk) and endpoint compromise (keyloggers/screen capture).
26. **Q**: How do you mitigate probing/invalid messages?  
    **A**: Strict schema parsing in relay WS; signaling server silently drops invalid payloads.
27. **Q**: How do you protect against room brute forcing?  
    **A**: Room IDs are random; join requires a capability token; rate limits apply.
28. **Q**: How do you prevent log leakage?  
    **A**: Fastify logger redacts request bodies and sensitive headers.
29. **Q**: Why not store messages encrypted on server to enable offline history?  
    **A**: That increases metadata and retention risk; this project is “ephemeral by design.”
30. **Q**: How do you test correctness of crypto?  
    **A**: Deterministic unit tests around encrypt/decrypt and payload framing; property tests; and interop tests across browsers.

#### 20 product questions
1. **Q**: Who is this for?  
   **A**: People who need ephemeral, low-trust coordination and teams demoing security-first comms.
2. **Q**: What’s the core promise?  
   **A**: “Server can’t read messages; sessions are ephemeral; panic-wipe is one action.”
3. **Q**: Why two modes (WS + P2P)?  
   **A**: WS relay is reliable and multi-party; P2P reduces server involvement for 1:1 chats.
4. **Q**: What’s the main UX risk?  
   **A**: Users misunderstanding that E2EE ≠ anonymity; we must explain threat model clearly.
5. **Q**: How do users join a room safely?  
   **A**: Share a link/QR containing a key in URL hash and a short-lived join token.
6. **Q**: What’s the onboarding story?  
   **A**: Create/join; explain key handling; show “connected” status and panic button.
7. **Q**: How do you handle abuse?  
   **A**: Rate limits, connection caps, room size caps, and token expiry/replay checks.
8. **Q**: What’s the retention story?  
   **A**: None—no message history; rooms expire; closing wipes local session state.
9. **Q**: What’s the differentiator vs Signal/WhatsApp?  
   **A**: It’s a web-based ephemeral engine with anti-forensics and minimal relay architecture, not a full messenger.
10. **Q**: What metrics do you track without violating privacy?  
    **A**: Aggregate counts and error rates, never message contents or user identifiers.
11. **Q**: How do you handle enterprise needs?  
    **A**: Add SSO, audit logging (carefully), admin controls, and managed TURN.
12. **Q**: What’s the pricing story?  
    **A**: Charge for managed relay + TURN + compliance add-ons, not for client code.
13. **Q**: What’s “panic wipe” for?  
    **A**: Fast exit from risky scenarios; reduce time secrets remain in memory.
14. **Q**: How do you educate users?  
    **A**: Built-in threat model banner + clear “does/doesn’t protect” sections.
15. **Q**: Why QR rotation?  
    **A**: Limits window for link reuse and reduces replay/forwarding exposure.
16. **Q**: How do you handle mobile?  
    **A**: Provide tunnel URL flow for HTTPS access from any network.
17. **Q**: What’s the killer demo?  
    **A**: Open tunnel URL on two devices, join, chat, hit panic wipe, show session disappears.
18. **Q**: What’s the biggest constraint?  
    **A**: Browser environment and network realities (TURN, NAT, device compromise).
19. **Q**: How do you handle compliance?  
    **A**: Minimal data collection helps; still need operational logs for availability without content.
20. **Q**: What’s the roadmap?  
    **A**: TURN integration, key verification UX, MLS group encryption, better anti-forensics.

#### 10 architecture questions
1. **Q**: Why Redis for room state?  
   **A**: TTL + atomic primitives + multi-node readiness.
2. **Q**: How does the unified proxy simplify the system?  
   **A**: One public origin for frontend + API + WS, enabling WebCrypto secure context and simpler CORS.
3. **Q**: Where is the “trust boundary”?  
   **A**: The client. Server is untrusted for content; it is trusted only for availability and admission control.
4. **Q**: How do you separate signaling vs relay responsibilities?  
   **A**: Different WS endpoints: `/signaling` for WebRTC handshake and `/ws` for chat relay.
5. **Q**: What’s the consistency model for room counts?  
   **A**: Redis scripts provide atomic join/leave updates; clients see eventual updates via broadcasts.
6. **Q**: Why not store room member metadata?  
   **A**: It increases risk; this repo stores only ephemeral connection ids and counts.
7. **Q**: How would you add multi-room concurrency?  
   **A**: Per-connection context holds roomId; allow switching with explicit leave/join events and TTL touch.
8. **Q**: How do you manage upgrades and compatibility?  
   **A**: Versioned message envelopes (`v:1`) and keeping legacy endpoints (e.g., `/healthz`).
9. **Q**: How do you handle schema validation?  
   **A**: Zod schemas for WS messages; invalid inputs close connection.
10. **Q**: What’s your stance on observability vs privacy?  
    **A**: Collect only aggregate metrics; redact logs; treat payloads as sensitive by default.

#### 10 scalability questions
1. **Q**: What breaks first at scale?  
   **A**: WS fanout CPU/event-loop time and LB connection limits.
2. **Q**: How do you scale WS broadcast?  
   **A**: Shard rooms across nodes; pub/sub for cross-node; optimize serialization.
3. **Q**: How do you handle 100k concurrent conns?  
   **A**: Multiple relay nodes with sticky sessions + autoscaling; consider uWebSockets.js or Rust.
4. **Q**: How do you reduce CPU per message?  
   **A**: Avoid repeated JSON serialization; pre-serialize once; enforce size caps; drop slow consumers.
5. **Q**: How do you scale Redis?  
   **A**: Use managed Redis with clustering or sharding; keep TTL keys small.
6. **Q**: How do you handle TURN scaling?  
   **A**: Deploy regional TURN pools, autoscale, and monitor relay bandwidth.
7. **Q**: How do you handle multi-party P2P?  
   **A**: Mesh doesn’t scale; use SFU or MLS for group keys + relay media.
8. **Q**: How do you do global latency optimization?  
   **A**: Edge relays, geo-DNS, and region-local TURN.
9. **Q**: How do you ensure rolling deploys don’t drop WS?  
   **A**: Connection draining + graceful shutdown + retries on clients.
10. **Q**: How do you test scale?  
    **A**: WS load tests (k6/artillery), synthetic rooms, and latency histograms.

#### 10 security questions
1. **Q**: Does this protect against a malicious server?  
   **A**: It protects content confidentiality if keys aren’t substituted; without key auth, MITM remains possible.
2. **Q**: How do you mitigate MITM?  
   **A**: Add fingerprint verification UX, signed key transparency, or out-of-band verification.
3. **Q**: How do you prevent XSS from stealing keys?  
   **A**: Strict CSP, avoid dangerous HTML injection, dependency hygiene; still difficult in web apps.
4. **Q**: Are keys stored anywhere?  
   **A**: No persistent storage intended; keys live in memory and are wiped best-effort.
5. **Q**: How do you protect against replay and flooding?  
   **A**: JTI replay checks + token buckets + connection caps + payload size limits.
6. **Q**: What about side-channels (timing/size)?  
   **A**: Padding/jitter/noise help, but cannot fully eliminate global correlation.
7. **Q**: What’s the impact of disabling TLS verification in dev?  
   **A**: It’s unsafe; should never be enabled in production.
8. **Q**: Does WebRTC leak IP addresses?  
   **A**: It can; TURN helps but changes threat model and cost; must disclose to users.
9. **Q**: What’s the incident response plan?  
   **A**: Rotate secrets, revoke tokens, deploy mitigations, and communicate threat model limitations.
10. **Q**: How do you handle supply-chain risks?  
    **A**: lockfiles, audits, minimal deps, and regular updates.

---

### 15. Limitations

- **Key authentication**: GhostWire ECDH exchange is not authenticated (MITM risk).
- **Browser compromise**: Keyloggers/screen capture defeat E2EE.
- **Traffic analysis**: Padding/jitter/noise are partial mitigations, not guarantees.
- **WebRTC reliability**: Without TURN, some networks won’t connect.
- **Ephemerality vs UX**: No history and aggressive wiping can frustrate users.
- **Scaling**: WS relay needs sticky sessions; P2P mesh doesn’t scale to groups.

---

### 16. Future Enhancements

- **Version 2 roadmap**:
  - TURN service integration + NAT diagnostics UI
  - Key verification flow (fingerprint QR, “safety number” UX)
  - MLS-based group key management (replace “room secret in URL hash”)
  - Better anti-forensics (service worker controls, cache partitioning checks)
- **Enterprise features**:
  - Managed tunnels and stable domains
  - Admin abuse controls, rate limit dashboards
  - Compliance-friendly aggregate telemetry
- **AI improvements**:
  - Local on-device classifier (optional) for improved sensitivity detection (still offline)
- **Monetization ideas**:
  - Hosted relay + TURN + SLA
  - Secure “incident rooms” with ephemeral audit approvals (privacy-preserving)

---

### 17. If This Was a Startup

- **Target market**: security-conscious teams, journalists/NGOs, incident response, privacy-first communities.
- **Revenue model**:
  - SaaS for hosted relays + TURN bandwidth
  - Enterprise contracts for private deployments
- **Pricing strategy**:
  - Free tier for limited rooms
  - Paid by concurrent connections + TURN bandwidth + compliance features
- **Market competitors**:
  - Signal (different platform)
  - Element/Matrix (different trust/retention model)
  - Various “secure chat” vendors
- **Differentiation**:
  - Web-first ephemeral engine with anti-forensics + traffic-camouflage focus.

---

### 18. If Asked “Why Should We Hire You Based on This?”

I built and can defend an end-to-end system that combines product UX and deep security engineering: a hardened WebSocket relay with Redis-backed ephemeral state, capability tokens with replay resistance, safe observability that respects E2EE boundaries, plus a parallel P2P WebRTC path with ECDH key exchange, padding/jitter/noise, and an anti-forensics UX layer. I can explain threat models honestly, identify where the design is strong vs incomplete (MITM, TURN, browser compromise), and propose practical next steps to make it production-grade.

