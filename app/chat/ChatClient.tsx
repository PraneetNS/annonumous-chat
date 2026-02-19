"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  decryptJson,
  encryptJson,
  importRoomKeyFromSecret,
  b64urlDecode,
  wipeBytes,
  encryptMediaFile,
  decryptMediaFile,
  type EncryptedMedia,
} from "../../lib/crypto";

// ── WebSocket URL resolution ─────────────────────────────────────────────────
const getWsUrl = () => {
  if (process.env.NEXT_PUBLIC_WS_URL) return process.env.NEXT_PUBLIC_WS_URL;
  if (typeof window === "undefined") return "wss://localhost:3001/ws";
  const { hostname, port, protocol } = window.location;
  if (port === "3000" && protocol === "https:") return `wss://${hostname}:4001/ws`;
  if (port === "4000" || port === "4001") {
    return `${protocol === "https:" ? "wss:" : "ws:"}//${hostname}:${port}/ws`;
  }
  if (
    hostname.includes("loca.lt") || hostname.includes("ngrok") ||
    hostname.includes("trycloudflare.com") || hostname.includes("serveo.net")
  ) {
    return `${protocol === "https:" ? "wss:" : "ws:"}//${hostname}/ws`;
  }
  return `wss://${hostname}:3001/ws`;
};

const getHealthUrl = () => {
  if (typeof window === "undefined") return "https://localhost:3001/healthz";
  const { hostname, port, protocol } = window.location;
  if (port === "3000" && protocol === "https:") return `https://${hostname}:4001/api/healthz`;
  if (
    port === "4000" || port === "4001" ||
    hostname.includes("loca.lt") || hostname.includes("ngrok") ||
    hostname.includes("trycloudflare.com") || hostname.includes("serveo.net")
  ) return "/api/healthz";
  return `https://${hostname}:3001/healthz`;
};

const WS_URL = getWsUrl();

// ── Message types ────────────────────────────────────────────────────────────
type TextMsg = { type: "text"; id: string; ts: number; from: string; text: string };
type SystemMsg = { type: "system"; id: string; ts: number; from: string; text: string };
type ImageMsg = { type: "image"; id: string; ts: number; from: string; objectUrl: string; mime: string; size: number };
type PlainChat = TextMsg | SystemMsg | ImageMsg;

// ── Constants ────────────────────────────────────────────────────────────────
const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB
const ACCEPTED_TYPES = "image/jpeg,image/png,image/gif,image/webp,image/avif,image/svg+xml";

// ── Main component ───────────────────────────────────────────────────────────
export default function ChatClient() {
  const sp = useSearchParams();
  const router = useRouter();

  const roomId = sp.get("roomId") ?? "";
  const token = sp.get("token") ?? "";
  const initialName = sp.get("name") ?? "";

  const [secret, setSecret] = useState<Uint8Array | null>(null);
  const [didCheckHash, setDidCheckHash] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.hash.slice(1));
    const k = params.get("k");
    if (!k) { setSecret(null); }
    else {
      try {
        const b = b64urlDecode(k);
        setSecret(b.byteLength === 32 ? b : null);
      } catch { setSecret(null); }
    }
    setDidCheckHash(true);
  }, []);

  const [label, setLabel] = useState<string>("?");
  const [participants, setParticipants] = useState<number>(0);
  const [connected, setConnected] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<PlainChat[]>([]);
  const [healthUrl, setHealthUrl] = useState("");
  const [uploadProgress, setUploadProgress] = useState<number | null>(null); // 0-100
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  useEffect(() => { setHealthUrl(getHealthUrl()); }, []);

  const wsRef = useRef<WebSocket | null>(null);
  const keyRef = useRef<CryptoKey | null>(null);
  const secretRef = useRef<Uint8Array | null>(null);
  const tokenRef = useRef<string>(token);
  const objectUrlsRef = useRef<Set<string>>(new Set());
  const bottomRef = useRef<HTMLDivElement | null>(null);

  // Revoke all held object URLs (called on exit/disconnect/unload)
  const revokeAllMedia = useCallback(() => {
    for (const url of objectUrlsRef.current) {
      URL.revokeObjectURL(url);
    }
    objectUrlsRef.current.clear();
  }, []);

  // Wipe all ephemeral state
  const wipeAll = useCallback(() => {
    setMessages([]);
    setLightboxUrl(null);
    revokeAllMedia();
    const s = secretRef.current;
    if (s) wipeBytes(s);
    secretRef.current = null;
    keyRef.current = null;
  }, [revokeAllMedia]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // ── WebSocket lifecycle ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!didCheckHash) return;
    if (!roomId || !token || !secret) {
      console.warn("Missing connection params, redirecting home");
      router.replace("/");
      return;
    }
    secretRef.current = secret;

    let stopped = false;
    let ws: WebSocket | null = null;

    const connect = async () => {
      if (stopped) return;
      try { ws = new WebSocket(WS_URL); }
      catch (err) { console.error("🔥 WS create error:", err); setConnected(false); return; }
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        setError(null);
        ws?.send(JSON.stringify({
          v: 1, t: "JOIN_REQUEST", id: crypto.randomUUID(),
          body: { roomId, token: tokenRef.current, label: initialName || undefined }
        }));
      };

      ws.onclose = (ev) => {
        setConnected(false);
        if (!stopped) setTimeout(connect, 3000);
      };

      ws.onerror = () => setConnected(false);

      ws.onmessage = async (ev) => {
        let msg: any;
        try { msg = JSON.parse(typeof ev.data === "string" ? ev.data : ""); } catch { return; }
        if (msg?.v !== 1 || typeof msg?.t !== "string") return;
        const body = msg.body;

        switch (msg.t) {
          case "JOINED":
            setLabel(body.label);
            setParticipants(body.participants);
            if (body.nextToken) tokenRef.current = body.nextToken;
            break;

          case "ROOM_STATS":
            if (body.roomId === roomId) setParticipants(body.participants);
            break;

          case "ERROR":
            setError(body.code);
            break;

          case "APP_MSG": {
            if (body.roomId !== roomId) return;
            const k = keyRef.current;
            if (!k) return;
            const p = await decryptJson<PlainChat>(k, body.ciphertextB64, "chat:v1");
            if (p) setMessages((prev) => [...prev.slice(-199), p]);
            break;
          }

          case "MEDIA_MSG": {
            // Decrypt incoming encrypted image and create an ephemeral object URL
            if (body.roomId !== roomId) return;
            const k = keyRef.current;
            if (!k) return;
            const media: EncryptedMedia = {
              mime: body.mime,
              size: body.size,
              chunkSize: body.chunkSize,
              chunks: body.chunks,
            };
            const blob = await decryptMediaFile(k, media);
            if (!blob) break;
            const url = URL.createObjectURL(blob);
            objectUrlsRef.current.add(url);
            const imgMsg: PlainChat = {
              type: "image",
              id: msg.id ?? crypto.randomUUID(),
              ts: Date.now(),
              from: body.from ?? "Someone",
              objectUrl: url,
              mime: body.mime,
              size: body.size,
            };
            setMessages((prev) => [...prev.slice(-199), imgMsg]);
            break;
          }

          case "SYSTEM_MSG": {
            const sysMsg: PlainChat = {
              type: "system",
              id: msg.id || crypto.randomUUID(),
              ts: Date.now(),
              from: "System",
              text: body.text,
            };
            setMessages((prev) => [...prev.slice(-199), sysMsg]);
            break;
          }

          case "HELLO":
            console.log("👋 Server said HELLO");
            break;
        }
      };
    };

    (async () => {
      try {
        const key = await importRoomKeyFromSecret(secret);
        keyRef.current = key;
        connect();
      } catch (err: any) {
        setError(
          err?.message?.includes("secure context") || err?.message?.includes("crypto.subtle")
            ? "🔒 This app requires HTTPS. Open it at https://localhost:4001."
            : `Crypto error: ${err?.message ?? err}`
        );
      }
    })();

    const beforeUnload = () => {
      wsRef.current?.close();
      wipeAll();
    };
    window.addEventListener("beforeunload", beforeUnload);

    return () => {
      stopped = true;
      window.removeEventListener("beforeunload", beforeUnload);
      ws?.close();
      wsRef.current = null;
      wipeAll();
    };
  }, [roomId, token, secret, router, wipeAll]);

  // ── Send text ────────────────────────────────────────────────────────────────
  async function sendText(text: string) {
    const ws = wsRef.current;
    const key = keyRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN || !key) return;
    const payload: PlainChat = { type: "text", id: crypto.randomUUID(), ts: Date.now(), from: label, text };
    const ct = await encryptJson(key, payload, "chat:v1");
    ws.send(JSON.stringify({ v: 1, t: "APP_MSG", id: crypto.randomUUID(), body: { roomId, ciphertextB64: ct } }));
  }

  // ── Send image ───────────────────────────────────────────────────────────────
  async function sendImage(file: File) {
    const ws = wsRef.current;
    const key = keyRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN || !key) return;
    if (file.size > MAX_IMAGE_BYTES) {
      setError(`Image too large (max 10 MB). This file is ${(file.size / 1024 / 1024).toFixed(1)} MB.`);
      return;
    }

    setUploadProgress(0);
    try {
      // Show sender a local preview immediately (ephemeral object URL)
      const localUrl = URL.createObjectURL(file);
      objectUrlsRef.current.add(localUrl);
      const localMsg: PlainChat = {
        type: "image", id: crypto.randomUUID(), ts: Date.now(),
        from: label, objectUrl: localUrl, mime: file.type, size: file.size,
      };
      setMessages((prev) => [...prev.slice(-199), localMsg]);

      setUploadProgress(20);
      const encrypted = await encryptMediaFile(key, file);
      setUploadProgress(80);

      ws.send(JSON.stringify({
        v: 1, t: "MEDIA_MSG", id: crypto.randomUUID(),
        body: {
          roomId,
          mime: encrypted.mime,
          size: encrypted.size,
          chunkSize: encrypted.chunkSize,
          chunks: encrypted.chunks,
          from: label,
        },
      }));
      setUploadProgress(100);
      setTimeout(() => setUploadProgress(null), 600);
    } catch (err: any) {
      setError(`Failed to send image: ${err?.message ?? err}`);
      setUploadProgress(null);
    }
  }

  function onExit() {
    if (!confirm("Exit chat? Keys and all images will be permanently deleted from this session.")) return;
    router.replace("/");
  }

  const fmtSize = (bytes: number) =>
    bytes < 1024 ? `${bytes} B` : bytes < 1048576 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1048576).toFixed(1)} MB`;

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <>
      {/* Lightbox overlay */}
      {lightboxUrl && (
        <div
          onClick={() => setLightboxUrl(null)}
          style={{
            position: "fixed", inset: 0, zIndex: 1000,
            background: "rgba(0,0,0,0.92)",
            display: "flex", alignItems: "center", justifyContent: "center",
            cursor: "zoom-out",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={lightboxUrl}
            alt="Preview"
            style={{ maxWidth: "92vw", maxHeight: "92vh", borderRadius: 12, boxShadow: "0 0 60px rgba(0,0,0,0.8)" }}
            onClick={(e) => e.stopPropagation()}
          />
          <button
            onClick={() => setLightboxUrl(null)}
            style={{
              position: "fixed", top: 20, right: 24,
              background: "rgba(255,255,255,0.12)", border: "none",
              color: "#fff", fontSize: 22, borderRadius: "50%",
              width: 40, height: 40, cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}
          >✕</button>
        </div>
      )}

      <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 16, background: "#080c10" }}>
        <section style={{
          width: "100%", maxWidth: 760,
          border: "1px solid #1e2a35",
          borderRadius: 18, padding: 20,
          background: "rgba(10,14,20,0.8)",
          backdropFilter: "blur(12px)",
          display: "grid", gap: 16,
          boxShadow: "0 8px 48px rgba(0,0,0,0.6)",
        }}>
          {/* Header */}
          <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
            <div>
              <div style={{ fontSize: 18, fontWeight: 800, color: "#e6edf3", letterSpacing: "-0.3px" }}>
                🔒 Encrypted Chat
              </div>
              <div style={{ fontSize: 12, color: "#7d9bb0", marginTop: 3 }}>
                <span style={{
                  display: "inline-block", width: 7, height: 7, borderRadius: "50%",
                  background: connected ? "#3fb950" : "#f85149",
                  marginRight: 6, verticalAlign: "middle",
                }} />
                {connected ? "Connected" : "Reconnecting…"} · {participants} participant{participants !== 1 ? "s" : ""} · You: <strong style={{ color: "#58a6ff" }}>{label}</strong>
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
              <button
                id="exit-chat-btn"
                onClick={onExit}
                style={{
                  padding: "5px 14px", borderRadius: 8,
                  border: "1px solid #f85149",
                  background: "transparent", color: "#f85149",
                  fontSize: 12, cursor: "pointer", fontWeight: 700,
                  transition: "background 0.15s",
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(248,81,73,0.12)"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "transparent"; }}
              >Exit Chat</button>
              <div style={{ textAlign: "right", fontSize: 10, color: "#6a7f8e" }}>
                Keys &amp; media wipe on close
              </div>
            </div>
          </header>

          {/* Error banner */}
          {error && (
            <div style={{
              padding: "10px 14px", borderRadius: 10,
              background: "rgba(248,81,73,0.12)", border: "1px solid rgba(248,81,73,0.4)",
              color: "#f85149", fontSize: 13, display: "flex", justifyContent: "space-between", alignItems: "center",
            }}>
              <span>{error}</span>
              <button onClick={() => setError(null)} style={{ background: "none", border: "none", color: "#f85149", cursor: "pointer", fontSize: 16 }}>✕</button>
            </div>
          )}

          {/* Upload progress bar */}
          {uploadProgress !== null && (
            <div style={{ borderRadius: 8, overflow: "hidden", background: "#1b2330", height: 4 }}>
              <div style={{
                height: "100%",
                width: `${uploadProgress}%`,
                background: "linear-gradient(90deg, #58a6ff, #3fb950)",
                transition: "width 0.3s ease",
              }} />
            </div>
          )}

          {/* Message feed */}
          <div
            id="message-feed"
            style={{
              height: "58vh", overflowY: "auto",
              border: "1px solid #1e2a35",
              borderRadius: 14, padding: "12px 14px",
              background: "#060a0f",
              display: "flex", flexDirection: "column", gap: 6,
              scrollbarWidth: "thin", scrollbarColor: "#1e2a35 transparent",
            }}
          >
            {messages.length === 0 ? (
              <div style={{ color: "#4a6070", fontSize: 13, textAlign: "center", marginTop: "auto", marginBottom: "auto" }}>
                🔐 End-to-end encrypted · No messages yet
              </div>
            ) : (
              messages.map((m) => <MessageRow key={m.id} msg={m} myLabel={label} onImageClick={setLightboxUrl} />)
            )}
            <div ref={bottomRef} />
          </div>

          {/* Composer */}
          <Composer onSend={sendText} onImage={sendImage} disabled={!connected} />

          {/* Connection failure hint */}
          {!connected && (
            <div style={{
              padding: "12px 16px", border: "1px solid #9a7a2a",
              borderRadius: 10, background: "rgba(219,166,66,0.08)", color: "#dba642", fontSize: 13,
            }}>
              <strong>Connection Failed?</strong><br />
              1. Make sure the server is running.<br />
              2. Trust the backend cert:&nbsp;
              <a href={healthUrl} target="_blank" rel="noopener noreferrer"
                style={{ color: "#dba642", fontWeight: "bold" }}>Open Backend API</a>
              &nbsp;→ Advanced → Proceed<br />
              3. Come back and refresh.
            </div>
          )}
        </section>
      </main>
    </>
  );
}

// ── MessageRow ────────────────────────────────────────────────────────────────
function MessageRow({
  msg, myLabel, onImageClick,
}: {
  msg: PlainChat;
  myLabel: string;
  onImageClick: (url: string) => void;
}) {
  const isMe = msg.from === myLabel;
  const isSystem = msg.type === "system";

  if (isSystem) {
    const m = msg as SystemMsg;
    return (
      <div style={{
        textAlign: "center",
        color: "#586d7a",
        fontSize: 11,
        padding: "2px 0",
        fontStyle: "italic",
      }}>
        {m.text}
      </div>
    );
  }

  if (msg.type === "image") {
    const m = msg as ImageMsg;
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: isMe ? "flex-end" : "flex-start", gap: 3 }}>
        <div style={{ fontSize: 11, color: "#4a6275", marginBottom: 2 }}>
          <span style={{ color: isMe ? "#58a6ff" : "#c9d1d9", fontWeight: 700 }}>{m.from}</span>
          &nbsp;&middot;&nbsp;{new Date(m.ts).toLocaleTimeString()}
        </div>
        <div
          onClick={() => onImageClick(m.objectUrl)}
          style={{
            cursor: "zoom-in",
            borderRadius: 12,
            overflow: "hidden",
            border: "1px solid #1e2a35",
            maxWidth: 320,
            boxShadow: "0 4px 20px rgba(0,0,0,0.5)",
            transition: "transform 0.15s, box-shadow 0.15s",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLDivElement).style.transform = "scale(1.02)";
            (e.currentTarget as HTMLDivElement).style.boxShadow = "0 8px 32px rgba(88,166,255,0.15)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLDivElement).style.transform = "scale(1)";
            (e.currentTarget as HTMLDivElement).style.boxShadow = "0 4px 20px rgba(0,0,0,0.5)";
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={m.objectUrl}
            alt="shared image"
            style={{ maxWidth: 320, maxHeight: 280, display: "block", objectFit: "cover" }}
          />
        </div>
        <div style={{ fontSize: 10, color: "#3a5060" }}>
          🔒 encrypted · {formatSize(m.size)} · tap to expand
        </div>
      </div>
    );
  }

  // Text message
  const m = msg as TextMsg;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: isMe ? "flex-end" : "flex-start", gap: 2 }}>
      <div style={{ fontSize: 11, color: "#4a6275" }}>
        <span style={{ color: isMe ? "#58a6ff" : "#c9d1d9", fontWeight: 700 }}>{m.from}</span>
        &nbsp;&middot;&nbsp;{new Date(m.ts).toLocaleTimeString()}
      </div>
      <div style={{
        maxWidth: "78%",
        padding: "8px 14px",
        borderRadius: isMe ? "16px 16px 4px 16px" : "16px 16px 16px 4px",
        background: isMe
          ? "linear-gradient(135deg, #1a3a5c, #1e4a7a)"
          : "#131c26",
        color: "#e6edf3",
        fontSize: 14,
        lineHeight: 1.5,
        border: isMe ? "1px solid #2a5080" : "1px solid #1e2a35",
        wordBreak: "break-word",
      }}>
        {m.text}
      </div>
    </div>
  );
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

// ── Composer ──────────────────────────────────────────────────────────────────
function Composer({
  onSend,
  onImage,
  disabled,
}: {
  onSend: (t: string) => void;
  onImage: (f: File) => void;
  disabled: boolean;
}) {
  const [value, setValue] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) onImage(file);
    e.target.value = ""; // reset so same file can be re-selected
  }

  return (
    <form
      id="message-composer"
      style={{ display: "flex", gap: 8, alignItems: "center" }}
      onSubmit={(e) => {
        e.preventDefault();
        const v = value.trim();
        if (!v) return;
        onSend(v);
        setValue("");
      }}
    >
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPTED_TYPES}
        style={{ display: "none" }}
        onChange={handleFile}
        aria-label="Attach image"
      />

      {/* Attach Action Button */}
      <button
        id="attach-image-btn"
        type="button"
        disabled={disabled}
        className="composer-action-btn"
        title="Share an Image"
        onClick={() => fileInputRef.current?.click()}
        style={{
          width: 48, height: 48, borderRadius: 14,
          border: disabled ? "1px solid #21262d" : "1px solid #30363d",
          background: disabled ? "#0d1117" : "linear-gradient(135deg, #1f2937, #111827)",
          color: disabled ? "#484f58" : "#58a6ff",
          cursor: disabled ? "not-allowed" : "pointer",
          display: "flex", alignItems: "center", justifyContent: "center",
          flexShrink: 0,
          transition: "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)",
          boxShadow: disabled ? "none" : "0 4px 20px rgba(0,0,0,0.4)",
        }}
        onMouseEnter={(e) => {
          if (!disabled) {
            e.currentTarget.style.borderColor = "#58a6ff";
            e.currentTarget.style.background = "#24292f";
            e.currentTarget.style.transform = "scale(1.05)";
          }
        }}
        onMouseLeave={(e) => {
          if (!disabled) {
            e.currentTarget.style.borderColor = "#30363d";
            e.currentTarget.style.background = "linear-gradient(135deg, #1f2937, #111827)";
            e.currentTarget.style.transform = "scale(1)";
          }
        }}
      >
        <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" />
        </svg>
      </button>

      {/* Text input */}
      <input
        id="message-input"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        disabled={disabled}
        placeholder={disabled ? "Connecting to secure relay..." : "Type an encrypted message..."}
        autoComplete="off"
        style={{
          flex: 1, padding: "11px 16px",
          borderRadius: 12, border: "1px solid #1e2a35",
          background: "#0b0f14", color: "#e6edf3",
          fontSize: 14, outline: "none",
          transition: "border-color 0.15s",
        }}
        onFocus={(e) => { (e.currentTarget as HTMLInputElement).style.borderColor = "#2a5080"; }}
        onBlur={(e) => { (e.currentTarget as HTMLInputElement).style.borderColor = "#1e2a35"; }}
      />

      {/* Send button */}
      <button
        id="send-message-btn"
        type="submit"
        disabled={disabled || !value.trim()}
        style={{
          padding: "11px 18px", borderRadius: 12,
          border: "none",
          background: disabled || !value.trim()
            ? "#131c26"
            : "linear-gradient(135deg, #1a6acc, #1e88e5)",
          color: disabled || !value.trim() ? "#3a5060" : "#fff",
          fontWeight: 700, fontSize: 14,
          cursor: disabled || !value.trim() ? "not-allowed" : "pointer",
          flexShrink: 0,
          transition: "background 0.15s",
        }}
      >
        Send
      </button>
    </form>
  );
}
