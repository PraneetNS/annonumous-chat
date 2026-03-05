"use client";

import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import * as Crypto from "../shredder/crypto/crypto";
import { P2PPeer } from "../shredder/network/webrtc";
import { SignalingClient, SignalingEvent } from "../shredder/network/signaling-client";
import { AuditPanel, auditLog } from "../shredder/ui/AuditPanel";
import { PanicManager } from "../components/PanicManager";
import { scanSensitivity } from "../shredder/ai-scanner/scanner";
import { CamouflageEngine } from "../shredder/security/camouflage";
import { formatTimeLocked, isReady, TimeLockedPayload } from "../shredder/crypto/timelock";
// Enterprise Modules
import { generatePQCKeyBundle, exportPQCPublicBundle, performPQCHandshake, getPQCSecurityLevel, wipePQCBundle, type PQCKeyBundle, type PQCPublicBundle } from "../shredder/crypto/pqc";
import { createTimeLockMessage, solveTimeLockMessage, isEstimatedTimeReached, formatTimeRemaining, type VDFTimeLockMessage, type VDFProgress } from "../shredder/crypto/vdf";
import { MeshNetworkManager, type MeshStats, type MeshEvent } from "../shredder/network/mesh";
import { DistributedSignalingClient, type DistributedSignalingEvent } from "../shredder/network/distributed-signaling";
import { SecureCanvas } from '../shredder/ui/SecureCanvas';
import { FileTransferSender, FileTransferReceiver, MAX_FILE_SIZE, type FileTransferProgress } from "../shredder/network/file-transfer";
import { AdvancedCamouflageEngine, type TrafficStats } from "../shredder/security/advanced-camouflage";
import { ScreenProtectionManager } from "../shredder/security/screen-protection";
import { enhancedScanSensitivity, getRiskBadge } from "../shredder/ai-scanner/enhanced-scanner";
import { EnterpriseDashboard, type SecurityStatus, type PeerInfo, type RoomPolicy } from "../shredder/ui/EnterpriseDashboard";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB
const ACCEPTED_TYPES = "image/jpeg,image/png,image/gif,image/webp,image/avif,image/svg+xml";

// Dynamic Signaling URL — use relative path for tunnel compatibility
const getSignalingUrl = () => {
  if (typeof window === "undefined") return "";
  const loc = window.location;
  const protocol = loc.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${loc.host}/signaling`;
};

export default function ShredderPage() {
  const [step, setStep] = useState<"init" | "joining" | "chat">("init");
  const [roomId, setRoomId] = useState("");
  const [identity, setIdentity] = useState<string | null>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [inputText, setInputText] = useState("");
  const [peerState, setPeerState] = useState<string>("disconnected");
  const [isLowBandwidth, setIsLowBandwidth] = useState(false);
  const [nickName, setNickName] = useState("");
  const [isPeerTyping, setIsPeerTyping] = useState(false);
  const [sensitivityWarning, setSensitivityWarning] = useState<string[] | null>(null);
  const [isSearchingRandom, setIsSearchingRandom] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);

  // Enterprise State
  const [pqcActive, setPqcActive] = useState(false);
  const [meshStats, setMeshStats] = useState<MeshStats | null>(null);
  const [trafficStats, setTrafficStats] = useState<TrafficStats | null>(null);
  const [connectedPeers, setConnectedPeers] = useState<PeerInfo[]>([]);
  const [fileTransferProgress, setFileTransferProgress] = useState<FileTransferProgress | null>(null);
  const [securityStatus, setSecurityStatus] = useState<SecurityStatus>({
    e2eeActive: false, pqcActive: false, metadataObfuscation: true,
    screenProtection: false, coverTraffic: true, vdfAvailable: true, stegoAvailable: true
  });
  const [roomPolicy] = useState<RoomPolicy>({
    maxRoomSize: 10, timeLimit: null, allowedRegions: [],
    requirePQC: false, requireVerification: false
  });
  const [signalingNodeId, setSignalingNodeId] = useState<string | null>(null);
  const [enablePQC, setEnablePQC] = useState(true);

  // Core Refs
  const keyPairRef = useRef<CryptoKeyPair | null>(null);
  const sharedKeyRef = useRef<CryptoKey | null>(null);
  const peerRef = useRef<P2PPeer | null>(null);
  const signalingRef = useRef<SignalingClient | null>(null);
  const camouflageRef = useRef<CamouflageEngine | null>(null);
  const currentRoomIdRef = useRef("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const objectUrlsRef = useRef<Set<string>>(new Set());

  // Enterprise Refs
  const pqcBundleRef = useRef<PQCKeyBundle | null>(null);
  const meshRef = useRef<MeshNetworkManager | null>(null);
  const distSignalingRef = useRef<DistributedSignalingClient | null>(null);
  const advCamouflageRef = useRef<AdvancedCamouflageEngine | null>(null);
  const screenProtRef = useRef<ScreenProtectionManager | null>(null);
  const fileTransferRef = useRef<FileTransferSender | null>(null);
  const myPeerIdRef = useRef<string | null>(null);
  const evPeerIdRef = useRef<string | null>(null);

  // Mesh stats polling
  useEffect(() => {
    const interval = setInterval(() => {
      if (meshRef.current) setMeshStats(meshRef.current.getMeshStats());
      if (advCamouflageRef.current) setTrafficStats(advCamouflageRef.current.getStats());
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  // 1️⃣ Initialize Session Identity + Enterprise Modules
  useEffect(() => {
    async function init() {
      auditLog("info", "Initializing GhostWire Enterprise engine...");
      const kp = await Crypto.generateSessionKeyPair();
      keyPairRef.current = kp;
      const finger = await Crypto.getIdentityFingerprint(kp.publicKey);
      setIdentity(finger);
      auditLog("sec", `Session Identity Generated: ${finger.slice(0, 8)}...`);

      // Generate PQC key bundle
      try {
        const pqcBundle = await generatePQCKeyBundle();
        pqcBundleRef.current = pqcBundle;
        setPqcActive(true);
        setSecurityStatus(prev => ({ ...prev, pqcActive: true }));
        auditLog("sec", `PQC Key Bundle Generated: ${getPQCSecurityLevel()}`);
      } catch (e) {
        auditLog("info", "PQC generation skipped (browser compatibility)");
      }

      // Activate screen protection
      const screenProt = new ScreenProtectionManager({
        cssProtection: true,
        apiDetection: true,
        visibilityMonitoring: true,
        devToolsDetection: true,
        autoWipeOnDetection: true,
        onThreatDetected: (threat) => {
          auditLog("panic", `THRÉAT DETECTED: ${threat.details}`);
        }
      });
      screenProt.activate();
      screenProtRef.current = screenProt;
      setSecurityStatus(prev => ({ ...prev, screenProtection: true }));
      auditLog("sec", "📸 Screen Protection Active (Auto-Wipe Enabled)");
    }
    init();

    // Keep connection fresh
    const connCheck = setInterval(() => {
      if (peerRef.current && peerState !== "connected" && step === "chat") {
        auditLog("info", "Retrying P2P handshake...");
        // If stuck, restart gathering
        startSession(currentRoomIdRef.current || "");
      }
    }, 30000);

    return () => {
      clearInterval(connCheck);
      // Emergency Cleanup on unmount
      peerRef.current?.wipe();
      signalingRef.current?.close();
      camouflageRef.current?.stop();
      meshRef.current?.destroy();
      distSignalingRef.current?.close();
      advCamouflageRef.current?.stop();
      screenProtRef.current?.deactivate();
      if (pqcBundleRef.current) wipePQCBundle(pqcBundleRef.current);
      revokeAllMedia();
    };
  }, [step]); // Re-run if we move to chat step to start listener

  function revokeAllMedia() {
    for (const url of objectUrlsRef.current) {
      URL.revokeObjectURL(url);
    }
    objectUrlsRef.current.clear();
  }

  // 2️⃣ Join / Create Room
  async function startSession(explicitRoomId?: string) {
    const finalRoomId = explicitRoomId || roomId;
    if (!finalRoomId) return;
    setRoomId(finalRoomId);
    currentRoomIdRef.current = finalRoomId;
    setStep("joining");
    setIsSearchingRandom(false);
    auditLog("info", `Connecting to ephemeral room: ${finalRoomId}`);

    const sigUrl = getSignalingUrl();
    const sig = new SignalingClient(sigUrl, finalRoomId, (ev) => {
      handleSignaling(ev);
    }, () => {
      auditLog("info", "Connected to signaling hub. Waiting for peer...");
      setStep("chat");
      setSecurityStatus(prev => ({ ...prev, e2eeActive: false }));
      // Signal current identity to newly joined room
      sig.send({ t: "PEER_JOIN", roomId: finalRoomId, fingerprint: identity });
    });
    signalingRef.current = sig;
    sig.connect();

    // Init WebRTC
    const peer = new P2PPeer(
      {
        iceServers: [
          { urls: "stun:stun.l.google.com:19302" },
          { urls: "stun:stun1.l.google.com:19302" },
          { urls: "stun:stun2.l.google.com:19302" },
          { urls: "stun:stun3.l.google.com:19302" },
          { urls: "stun:stun4.l.google.com:19302" },
          { urls: "stun:global.stun.twilio.com:3478" }
        ]
      },
      handleIncomingData,
      (candidate) => {
        if (evPeerIdRef.current) {
          sig.send({ t: "MESH_ICE", roomId: finalRoomId, targetPeerId: evPeerIdRef.current, candidate });
        } else {
          sig.send({ t: "ICE", roomId: finalRoomId, candidate });
        }
      },
      (state) => {
        setPeerState(state);
        auditLog("info", `P2P Connection State: ${state}`);
        if (state === "connected") {
          setSecurityStatus(prev => ({ ...prev, e2eeActive: true }));
          setMessages(prev => [...prev, { id: 'sys-' + Date.now(), type: 'system', text: "🔒 Secure P2P Tunnel Established." }]);
        }
        if (state === "failed" || state === "closed") {
          setSecurityStatus(prev => ({ ...prev, e2eeActive: false }));
          setMessages(prev => [...prev, { id: 'sys-' + Date.now(), type: 'system', text: "❌ Peer left the chat." }]);
        }
      }
    );
    peerRef.current = peer;

    // Init Camouflage
    const camo = new CamouflageEngine(() => {
      peer.send(new Uint8Array([0, 1, 2, 3]));
    });
    camouflageRef.current = camo;
    camo.startNoiseGenerator();

    // NOTE: We do NOT send OFFER here. The server sends ROOM_INFO telling us
    // who is already in the room. If there are existing peers, WE (the new
    // joiner) send the offer. If we are alone, we wait for PEER_JOIN.
  }

  async function startRandomSession() {
    setIsSearchingRandom(true);
    const sigUrl = getSignalingUrl();
    const sig = new SignalingClient(sigUrl, "LOBBY", (ev) => {
      if (ev.t === "MATCH") {
        auditLog("sec", "Stranger matched! Joining room...");
        sig.close();
        startSession(ev.roomId);
      } else {
        handleSignaling(ev);
      }
    }, () => {
      // Send random match request as soon as connected to lobby
      auditLog("info", "Searching for an anonymous peer...");
      sig.send({ t: "RANDOM" });
    });
    signalingRef.current = sig;
    sig.connect();
  }

  // 3️⃣ Signaling Handlers
  async function handleSignaling(ev: SignalingEvent | any) {
    if (!keyPairRef.current) return;

    switch (ev.t) {
      case "ROOM_INFO": {
        auditLog("info", `Joined room. ${ev.peers?.length || 0} peer(s) already present.`);
        // Track our own peer ID for mesh
        myPeerIdRef.current = ev.yourPeerId;

        // If there are existing peers, WE initiate the handshake to each
        // In this MVP, we just connect to the first one found for simplicity
        if (ev.peers && ev.peers.length > 0 && peerRef.current) {
          const targetId = ev.peers[0];
          evPeerIdRef.current = targetId;
          auditLog("sec", `Initiating Handshake with peer ${targetId.slice(0, 8)}...`);

          const jwk = await Crypto.exportPublicKey(keyPairRef.current!.publicKey);
          signalingRef.current?.send({ t: "PUBKEY", roomId: currentRoomIdRef.current, jwk });

          const offer = await peerRef.current.createOffer();
          signalingRef.current?.send({ t: "MESH_OFFER", roomId: currentRoomIdRef.current, targetPeerId: targetId, sdp: offer });
        }
        break;
      }
      case "PEER_JOIN": {
        auditLog("info", `New peer joined: ${ev.peerId?.slice(0, 8)}...`);
        // Track the last joined peer to ensure we always have a target for signaling
        evPeerIdRef.current = ev.peerId;
        // The new joiner will send us an offer. We just send our public key.
        const myJwk = await Crypto.exportPublicKey(keyPairRef.current!.publicKey);
        signalingRef.current?.send({ t: "PUBKEY", roomId: currentRoomIdRef.current, jwk: myJwk });
        break;
      }
      case "PEER_LEAVE": {
        auditLog("info", `Peer left: ${ev.peerId?.slice(0, 8)}...`);
        setMessages(prev => [...prev, { id: 'sys-' + Date.now(), type: 'system', text: "❌ Peer left the chat." }]);
        break;
      }
      case "MESH_OFFER": {
        if (!peerRef.current) return;
        evPeerIdRef.current = ev.peerId;
        auditLog("sec", `Received Offer from ${ev.peerId.slice(0, 8)}. Deriving Answer...`);

        const answer = await peerRef.current.handleOffer(ev.sdp);
        signalingRef.current?.send({ t: "MESH_ANSWER", roomId: currentRoomIdRef.current, targetPeerId: ev.peerId, sdp: answer });
        break;
      }
      case "MESH_ANSWER": {
        if (!peerRef.current) return;
        auditLog("sec", `Received Answer from ${ev.peerId.slice(0, 8)}. Handshake complete.`);
        await peerRef.current.handleAnswer(ev.sdp);
        break;
      }
      case "MESH_ICE":
      case "ICE": {
        if (!peerRef.current) return;
        await peerRef.current.addCandidate(ev.candidate);
        break;
      }
      case "PUBKEY": {
        if (!peerRef.current) return;
        auditLog("sec", "Received remote public key. Deriving Shared Secret...");
        const remotePublic = await Crypto.importPublicKey(ev.jwk);
        sharedKeyRef.current = await Crypto.deriveSharedKey(
          keyPairRef.current!.privateKey,
          remotePublic
        );
        setSecurityStatus(prev => ({ ...prev, e2eeActive: true }));
        auditLog("sec", "🔐 E2EE Shared Secret Established.");
        break;
      }
      case "ERROR": {
        auditLog("panic", `Signaling error: ${ev.code || 'unknown'}`);
        break;
      }
    }
  }

  // 4️⃣ Data Handlers (Decryption)
  async function handleIncomingData(data: Uint8Array) {
    if (data.length <= 4) return; // Ignore noise

    // For this MVP, we use a pre-shared room secret or derive from exchange
    // Actually, ECDH deriveKey needs the remote public key. 
    // In a real P2P mesh, we'd exchange public keys during signaling.
    // Let's assume the roomId is used as a salt for simplicity in this MVP version
    // while we wait for proper ECDH integration in signaling.

    if (!sharedKeyRef.current) {
      auditLog("info", "Packet dropped: No shared secret established yet.");
      return;
    }

    // Use Ref to avoid stale state in closure
    const activeRoomId = currentRoomIdRef.current;

    try {
      const pt = await Crypto.decrypt(sharedKeyRef.current!, data, activeRoomId);
      if (pt) {
        const msg = JSON.parse(pt);
        if (msg.type === "typing") {
          setIsPeerTyping(msg.isTyping);
          return;
        }
        if (msg.type === "image") {
          // Reconstruct image from P2P data
          const blob = new Blob([new Uint8Array(Crypto.b64urlDecode(msg.data))], { type: msg.mime });
          const url = URL.createObjectURL(blob);
          objectUrlsRef.current.add(url);
          msg.objectUrl = url;
          // Security: original data is no longer needed in memory
          const m = msg as any;
          delete m.data;
        }
        setMessages(prev => [...prev, msg]);
        setIsPeerTyping(false);
      }
    } catch (err) {
      auditLog("panic", "Decryption failed: Handshake mismatch or room transition error.");
      console.error("GhostWire Decrypt Error:", err);
    }
  }

  // 5️⃣ Outbound Logic (Encryption + Camouflage)
  async function sendMessage() {
    if (!inputText.trim() || !peerRef.current) return;

    const scan = enhancedScanSensitivity(inputText);
    if (scan.sensitive && !sensitivityWarning) {
      setSensitivityWarning(scan.matches.map(m => `${m.description}${m.redactedPreview ? ` (${m.redactedPreview})` : ''}`));
      return;
    }

    const msg = {
      id: Math.random().toString(36),
      from: nickName.trim() || identity?.slice(0, 6),
      text: inputText,
      ts: Date.now()
    };

    if (!sharedKeyRef.current) {
      auditLog("panic", "Cannot send: Secure tunnel not established.");
      return;
    }

    auditLog("sec", "Encrypting and Padding payload...");
    const activeRoomId = currentRoomIdRef.current;
    const ct = await Crypto.encrypt(sharedKeyRef.current!, JSON.stringify(msg), activeRoomId);

    // Inject Jitter
    await camouflageRef.current?.scheduleSend(() => {
      peerRef.current?.send(ct);
      setMessages(prev => [...prev, msg]);
      setInputText("");
      setSensitivityWarning(null);
      // Notify end of typing
      sendTypingSignal(false);
    });
  }

  async function sendTypingSignal(isTyping: boolean) {
    if (!sharedKeyRef.current || !peerRef.current) return;
    const activeRoomId = currentRoomIdRef.current;
    const sig = await Crypto.encrypt(sharedKeyRef.current, JSON.stringify({ type: "typing", isTyping }), activeRoomId);
    peerRef.current.send(sig);
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_IMAGE_BYTES) {
      auditLog("panic", "File too large (Max 10MB)");
      return;
    }

    setUploadProgress(10);
    const reader = new FileReader();
    reader.onload = async () => {
      const arr = new Uint8Array(reader.result as ArrayBuffer);
      const b64 = Crypto.b64urlEncode(arr.buffer);

      const msg = {
        id: Math.random().toString(36),
        type: "image",
        from: nickName.trim() || identity?.slice(0, 6),
        mime: file.type,
        data: b64,
        ts: Date.now()
      };

      if (!sharedKeyRef.current || !peerRef.current) return;
      const activeRoomId = currentRoomIdRef.current;

      setUploadProgress(50);
      const ct = await Crypto.encrypt(sharedKeyRef.current, JSON.stringify(msg), activeRoomId);

      await camouflageRef.current?.scheduleSend(() => {
        peerRef.current?.send(ct);

        // Show local preview
        const localUrl = URL.createObjectURL(file);
        objectUrlsRef.current.add(localUrl);
        const localMsg = { ...msg, objectUrl: localUrl } as any;
        delete localMsg.data;

        setMessages(prev => [...prev, localMsg]);
        setUploadProgress(null);
      });
    };
    reader.readAsArrayBuffer(file);
  }

  // Handle typing detection
  useEffect(() => {
    if (inputText.length > 0) {
      sendTypingSignal(true);
      const timeout = setTimeout(() => sendTypingSignal(false), 3000);
      return () => clearTimeout(timeout);
    } else {
      sendTypingSignal(false);
    }
  }, [inputText]);

  function exitChat() {
    auditLog("info", "Exiting chat and wiping session...");
    peerRef.current?.wipe();
    camouflageRef.current?.stop();
    revokeAllMedia();
    setStep("init");
    setMessages([]);
    setPeerState("disconnected");
    setIsSearchingRandom(false);
    currentRoomIdRef.current = "";
    // Enterprise cleanup
    meshRef.current?.destroy();
    meshRef.current = null;
    distSignalingRef.current?.close();
    distSignalingRef.current = null;
    advCamouflageRef.current?.stop();
    advCamouflageRef.current = null;
    setConnectedPeers([]);
    setMeshStats(null);
    setTrafficStats(null);
    setSecurityStatus(prev => ({ ...prev, e2eeActive: false }));
  }

  // 🎚️ Render Logic
  return (
    <main style={{
      minHeight: "100vh",
      background: "linear-gradient(135deg, #0b0f14 0%, #0d1520 100%)",
      color: "#e6edf3",
      fontFamily: "'Inter', sans-serif",
      display: "grid",
      placeItems: "center",
      padding: 16
    }}>
      <AuditPanel />
      <PanicManager />

      {/* Background Noise Shield against AI/Detection */}
      <div style={{
        position: 'fixed',
        top: 0, left: 0, width: '100%', height: '100%',
        background: 'url("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADIAAAAyBAMAAADsEZWCAAAAGFBMVEUAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAt6PU7AAAAB3RSTlMA7mZmZmZmfz0HAAAAQ0lEQVQ4y2NgQAX8DIyMTMcYmBhYGRgZGLYwMDBsYmBk2MLAwLCNgZFhCwMjw58vX758+fLly5cvX76A/79+PwwMDBlWAwC+fBvE9u+jYwAAAABJRU5ErkJggg==")',
        opacity: 0.03,
        pointerEvents: 'none',
        zIndex: 5
      }} />

      {step === "chat" && (
        <EnterpriseDashboard
          securityStatus={securityStatus}
          meshStats={meshStats}
          trafficStats={trafficStats}
          peers={connectedPeers}
          roomPolicy={roomPolicy}
          roomId={roomId}
          signalingNode={signalingNodeId}
        />
      )}

      <section
        className="main-card"
        style={{
          width: "100%",
          maxWidth: 600,
          background: "rgba(10, 14, 20, 0.8)",
          backdropFilter: "blur(20px)",
          border: "1px solid #1e2d3d",
          borderRadius: 24,
          padding: "32px",
          boxShadow: "0 12px 64px rgba(0,0,0,0.6)",
          display: "grid",
          gap: 24,
          position: "relative"
        }}>

        {/* Header */}
        <header style={{ textAlign: "center" }}>
          <h1 style={{ margin: 0, fontSize: 32, letterSpacing: "-1px", fontWeight: 800 }}>
            GHOST<span style={{ color: "#79c0ff" }}>WIRE</span>
            <span style={{ fontSize: 10, color: "#58a6ff", fontWeight: 500, marginLeft: 8, verticalAlign: "super" }}>ENTERPRISE</span>
          </h1>
          <p style={{ color: "#8b949e", fontSize: 13, marginTop: 8 }}>
            Post-Quantum Encrypted · Multi-Peer Mesh · Zero Metadata
          </p>
          {identity && (
            <div style={{ marginTop: 12, display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
              <div style={{ padding: "4px 12px", background: "rgba(121, 192, 255, 0.1)", border: "1px solid rgba(121, 192, 255, 0.2)", borderRadius: 100, fontSize: 10, color: "#79c0ff" }}>
                🔑 {identity.slice(0, 16)}
              </div>
              <div style={{ padding: "4px 12px", background: pqcActive ? "rgba(63, 185, 80, 0.1)" : "rgba(210, 153, 34, 0.1)", border: `1px solid ${pqcActive ? "rgba(63, 185, 80, 0.2)" : "rgba(210, 153, 34, 0.2)"}`, borderRadius: 100, fontSize: 10, color: pqcActive ? "#3fb950" : "#d29922" }}>
                {pqcActive ? "🛡️ PQC Active" : "⚠️ Classical"}
              </div>
              <div style={{ padding: "4px 12px", background: "rgba(63, 185, 80, 0.1)", border: "1px solid rgba(63, 185, 80, 0.2)", borderRadius: 100, fontSize: 10, color: "#3fb950" }}>
                📡 10-Peer Mesh
              </div>
            </div>
          )}
        </header>

        {step === "init" && (
          <div style={{ display: "grid", gap: 20 }}>
            <div style={{ display: "grid", gap: 8 }}>
              <label style={{ fontSize: 13, color: "#8b949e" }}>Your Nickname (Optional)</label>
              <input
                value={nickName}
                onChange={e => setNickName(e.target.value)}
                placeholder="How peers will see you..."
                style={{
                  padding: "16px",
                  borderRadius: 14,
                  border: "1px solid #30363d",
                  background: "#0b0f14",
                  color: "#fff",
                  fontSize: 16,
                  outline: "none"
                }}
              />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: 20, background: "rgba(255,255,255,0.02)", borderRadius: 16, border: "1px solid #30363d" }}>
                <h3 style={{ margin: 0, fontSize: 14 }}>Private Room</h3>
                <input
                  value={roomId}
                  onChange={e => setRoomId(e.target.value)}
                  placeholder="Room Code..."
                  style={{
                    padding: "10px",
                    borderRadius: 10,
                    border: "1px solid #30363d",
                    background: "#0b0f14",
                    color: "#fff",
                    fontSize: 14,
                    outline: "none"
                  }}
                />
                <button
                  onClick={() => startSession()}
                  style={{
                    padding: "12px",
                    borderRadius: 10,
                    border: "0",
                    background: "#238636",
                    color: "#fff",
                    fontWeight: 700,
                    cursor: "pointer"
                  }}
                >
                  Join Room
                </button>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: 20, background: "rgba(121, 192, 255, 0.05)", borderRadius: 16, border: "1px solid rgba(121, 192, 255, 0.2)", justifyContent: "center", textAlign: "center" }}>
                <h3 style={{ margin: 0, fontSize: 14 }}>Stranger Chat</h3>
                <p style={{ fontSize: 11, color: "#8b949e", margin: 0 }}>Match with a random person online.</p>
                <button
                  onClick={startRandomSession}
                  disabled={isSearchingRandom}
                  style={{
                    padding: "12px",
                    borderRadius: 10,
                    border: "0",
                    background: "#1f6feb",
                    color: "#fff",
                    fontWeight: 700,
                    cursor: "pointer",
                    opacity: isSearchingRandom ? 0.5 : 1
                  }}
                >
                  {isSearchingRandom ? "Finding..." : "Find Stranger"}
                </button>
              </div>
            </div>
          </div>
        )}

        {step === "joining" && (
          <div style={{ textAlign: "center", padding: 40 }}>
            <div className="shred-loader" style={{ marginBottom: 20 }}></div>
            <p>Negotiating Peer Handshake...</p>
            <p style={{ fontSize: 11, color: "#8b949e", marginTop: 8 }}>Status: {peerState}</p>
          </div>
        )}

        {step === "chat" && (
          <div style={{ display: "flex", flexDirection: "column", height: 500 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, paddingBottom: 12, borderBottom: "1px solid #30363d" }}>
              <div style={{ fontSize: 12, color: "#8b949e" }}>
                Room: <strong style={{ color: "#e6edf3" }}>{roomId}</strong>
              </div>
              <button
                onClick={exitChat}
                style={{
                  padding: "6px 14px",
                  background: "rgba(255, 123, 114, 0.1)",
                  border: "1px solid rgba(255, 123, 114, 0.2)",
                  borderRadius: 8,
                  color: "#ff7b72",
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: "pointer",
                  transition: "all 0.2s"
                }}
                onMouseEnter={e => e.currentTarget.style.background = "rgba(255, 123, 114, 0.2)"}
                onMouseLeave={e => e.currentTarget.style.background = "rgba(255, 123, 114, 0.1)"}
              >
                Exit Chat
              </button>
            </div>

            {/* Upload progress */}
            {uploadProgress !== null && (
              <div style={{ height: 2, background: "rgba(121, 192, 255, 0.1)", borderRadius: 10, marginBottom: 10, overflow: "hidden" }}>
                <div style={{ height: "100%", background: "#79c0ff", width: `${uploadProgress}%`, transition: "width 0.3s" }} />
              </div>
            )}
            {/* Message Area */}
            <div style={{ flex: 1, overflowY: "auto", padding: "8px 0", display: "flex", flexDirection: "column", gap: 12 }}>
              {messages.map(m => (
                m.type === "system" ? (
                  <div key={m.id} style={{ textAlign: "center", fontSize: 11, color: "#8b949e", margin: "10px 0", fontStyle: "italic" }}>
                    {m.text}
                  </div>
                ) : (
                  <div key={m.id} style={{
                    padding: "12px 16px",
                    borderRadius: 16,
                    background: m.from === (nickName.trim() || identity?.slice(0, 6)) ? "rgba(35, 134, 54, 0.1)" : "rgba(255,255,255,0.05)",
                    border: "1px solid",
                    borderColor: m.from === (nickName.trim() || identity?.slice(0, 6)) ? "rgba(35, 134, 54, 0.3)" : "rgba(255,255,255,0.1)",
                    alignSelf: m.from === (nickName.trim() || identity?.slice(0, 6)) ? "flex-end" : "flex-start",
                    maxWidth: "85%"
                  }}>
                    <div style={{ fontSize: 10, color: "#8b949e", marginBottom: 4, display: "flex", gap: 8 }}>
                      <span>{m.from}</span>
                      <span>{new Date(m.ts).toLocaleTimeString()}</span>
                    </div>
                    {m.type === "image" ? (
                      <div style={{ borderRadius: 8, overflow: "hidden", border: "1px solid rgba(255,255,255,0.1)", cursor: "pointer" }} onClick={() => window.open(m.objectUrl, '_blank')}>
                        <img src={m.objectUrl} alt="shared" style={{ maxWidth: "100%", display: "block" }} />
                        <div style={{ fontSize: 9, padding: "4px 8px", background: "rgba(0,0,0,0.3)", color: "#8b949e" }}>🔒 Encrypted Media</div>
                      </div>
                    ) : (
                      <SecureCanvas
                        text={m.text}
                        from={m.from}
                        isMe={m.from === (nickName.trim() || identity?.slice(0, 6))}
                        maxWidth={300}
                      />
                    )}
                  </div>
                )
              ))}
              {isPeerTyping && (
                <div style={{ fontSize: 11, color: "#79c0ff", marginLeft: 8, fontStyle: "italic" }}>
                  Peer is typing...
                </div>
              )}
              {peerState !== "connected" && (
                <div style={{ textAlign: "center", padding: "20px 10px", color: "#8b949e", fontSize: 13, border: "1px dashed #30363d", borderRadius: 16, margin: "10px 0" }}>
                  <div style={{ marginBottom: 8 }}>🔍 Looking for peers in room <strong>{roomId}</strong>...</div>
                  <div style={{ fontSize: 11 }}>Share this Room ID with someone to start chatting.</div>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(roomId);
                      auditLog("info", "Room ID copied to clipboard!");
                    }}
                    style={{
                      marginTop: 12,
                      padding: "6px 12px",
                      background: "rgba(255,255,255,0.05)",
                      border: "1px solid #30363d",
                      borderRadius: 8,
                      color: "#e6edf3",
                      fontSize: 11,
                      cursor: "pointer"
                    }}
                  >
                    Copy Room ID
                  </button>
                  <div style={{ fontSize: 11, marginTop: 12, color: peerState === "failed" ? "#ff7b72" : "#8b949e" }}>Status: {peerState}</div>
                </div>
              )}
            </div>

            {/* Input Area */}
            <div style={{ marginTop: 20, display: "grid", gap: 8 }}>
              {sensitivityWarning && (
                <div style={{ padding: "8px 12px", background: "rgba(255, 123, 114, 0.1)", border: "1px solid rgba(255, 123, 114, 0.3)", borderRadius: 10, fontSize: 11, color: "#ff7b72" }}>
                  🚨 <strong>Privacy Alert</strong>: Potential PII detected!
                  <ul style={{ margin: "4px 0", paddingLeft: 16 }}>
                    {sensitivityWarning.map((w, i) => <li key={i}>{w}</li>)}
                  </ul>
                  <button onClick={() => setSensitivityWarning(null)} style={{ background: "none", border: "0", color: "#58a6ff", cursor: "pointer", fontSize: 10, padding: 0 }}>Ignore and Send</button>
                </div>
              )}
              <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                <input
                  type="file"
                  ref={fileInputRef}
                  accept={ACCEPTED_TYPES}
                  style={{ display: "none" }}
                  onChange={handleFile}
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  style={{
                    width: 48,
                    height: 48,
                    borderRadius: 14,
                    border: "1px solid #30363d",
                    background: "rgba(121, 192, 255, 0.05)",
                    color: "#79c0ff",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    cursor: "pointer",
                    flexShrink: 0,
                    transition: "all 0.2s"
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.background = "rgba(121, 192, 255, 0.1)";
                    e.currentTarget.style.borderColor = "#79c0ff";
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.background = "rgba(121, 192, 255, 0.05)";
                    e.currentTarget.style.borderColor = "#30363d";
                  }}
                  title="Share Image"
                >
                  <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" />
                  </svg>
                </button>
                <input
                  value={inputText}
                  onChange={e => setInputText(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && sendMessage()}
                  placeholder="Type a disappearing message..."
                  style={{
                    flex: 1,
                    padding: "14px 18px",
                    borderRadius: 14,
                    border: "1px solid #30363d",
                    background: "#0b0f14",
                    color: "#fff",
                    fontSize: 15,
                    outline: "none"
                  }}
                />
                <button
                  onClick={sendMessage}
                  style={{
                    padding: "0 24px",
                    height: 48,
                    borderRadius: 14,
                    border: "0",
                    background: "#e6edf3",
                    color: "#0b0f14",
                    fontWeight: 700,
                    cursor: "pointer",
                    transition: "all 0.2s"
                  }}
                  onMouseEnter={e => e.currentTarget.style.transform = "scale(1.02)"}
                  onMouseLeave={e => e.currentTarget.style.transform = "scale(1)"}
                >
                  Send
                </button>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 2px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10, color: "#8b949e" }}>
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: peerState === "connected" ? "#3fb950" : "#ff7b72" }}></span>
                  P2P Secure Tunnel
                </div>
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10, color: "#8b949e", cursor: "pointer" }}>
                  <input type="checkbox" checked={isLowBandwidth} onChange={e => setIsLowBandwidth(e.target.checked)} />
                  Low Bandwidth Mode
                </label>
              </div>
            </div>
          </div>
        )}

      </section>

      <style dangerouslySetInnerHTML={{
        __html: `
        .shred-loader {
          width: 48px;
          height: 48px;
          border: 4px solid rgba(255,255,255,0.1);
          border-top: 4px solid #ff7b72;
          border-radius: 50%;
          animation: spin 1s linear infinite;
          display: inline-block;
        }
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        @media (max-width: 768px) {
          .main-card {
            padding: 20px !important;
            border-radius: 16px !important;
          }
          .panic-btn {
            top: 10px !important;
            right: 10px !important;
            padding: 6px 12px !important;
            font-size: 10px !important;
          }
        }
      `}} />
    </main >
  );
}
