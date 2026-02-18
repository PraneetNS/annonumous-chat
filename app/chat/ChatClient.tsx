"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { decryptJson, encryptJson, importRoomKeyFromSecret, b64urlDecode, wipeBytes } from "../../lib/crypto";

// Dynamic WebSocket URL: Connects to Next.js proxy at /ws, which forwards to backend
const getWsUrl = () => {
  if (process.env.NEXT_PUBLIC_WS_URL) return process.env.NEXT_PUBLIC_WS_URL;
  if (typeof window === "undefined") return "wss://localhost:3001/ws";

  const hostname = window.location.hostname;
  const port = window.location.port;
  const protocol = window.location.protocol;

  // If we are on port 3000 (HTTPS frontend), use HTTPS proxy on 4001
  if (port === "3000" && protocol === "https:") {
    return `wss://${hostname}:4001/ws`;
  }

  // If we are on port 4000 (HTTP proxy) or 4001 (HTTPS proxy), use /ws relative to origin
  if (port === "4000" || port === "4001") {
    const wsProto = protocol === "https:" ? "wss:" : "ws:";
    return `${wsProto}//${hostname}:${port}/ws`;
  }

  // tunnel services
  if (hostname.includes("loca.lt") || hostname.includes("ngrok") ||
    hostname.includes("trycloudflare.com") || hostname.includes("serveo.net")) {
    const wsProto = protocol === "https:" ? "wss:" : "ws:";
    return `${wsProto}//${hostname}/ws`;
  }

  return `wss://${hostname}:3001/ws`;
};

const WS_URL = getWsUrl();

const getHealthUrl = () => {
  if (typeof window === "undefined") return "https://localhost:3001/healthz";
  const hostname = window.location.hostname;
  const port = window.location.port;
  const protocol = window.location.protocol;

  if (port === "3000" && protocol === "https:") {
    return `https://${hostname}:4001/api/healthz`;
  }

  if (port === "4000" || port === "4001" ||
    hostname.includes("loca.lt") || hostname.includes("ngrok") ||
    hostname.includes("trycloudflare.com") || hostname.includes("serveo.net")) {
    return "/api/healthz";
  }

  return `https://${hostname}:3001/healthz`;
};

type JoinedMsg = { t: "JOINED"; v: 1; body: { roomId: string; label: string; participants: number } };
type RoomStatsMsg = { t: "ROOM_STATS"; v: 1; body: { roomId: string; participants: number } };
type AppMsg = { t: "APP_MSG"; v: 1; body: { roomId: string; ciphertextB64: string } };
type ErrMsg = { t: "ERROR"; v: 1; body: { code: string } };

type PlainChat = { type: "text"; id: string; ts: number; from: string; text: string };

export default function ChatClient() {
  const sp = useSearchParams();
  const router = useRouter();

  const roomId = sp.get("roomId") ?? "";
  const token = sp.get("token") ?? "";

  // Client-side only state to hold the secret from the URL hash.
  const [secret, setSecret] = useState<Uint8Array | null>(null);
  const [didCheckHash, setDidCheckHash] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.hash.slice(1));
    const k = params.get("k");
    if (!k) {
      setSecret(null);
    } else {
      try {
        const b = b64urlDecode(k);
        setSecret(b.byteLength === 32 ? b : null);
      } catch {
        setSecret(null);
      }
    }
    setDidCheckHash(true);
  }, []);

  const [label, setLabel] = useState<string>("?");
  const [participants, setParticipants] = useState<number>(0);
  const [connected, setConnected] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<PlainChat[]>([]);
  const [healthUrl, setHealthUrl] = useState("");

  useEffect(() => {
    setHealthUrl(getHealthUrl());
  }, []);

  const wsRef = useRef<WebSocket | null>(null);
  const keyRef = useRef<CryptoKey | null>(null);
  const secretRef = useRef<Uint8Array | null>(null);
  const tokenRef = useRef<string>(token);

  useEffect(() => {
    if (!didCheckHash) return; // Wait for hash check
    if (!roomId || !token || !secret) {
      console.warn("Missing connection params, redirecting home", { roomId, hasToken: !!token, hasSecret: !!secret });
      router.replace("/");
      return;
    }
    secretRef.current = secret;

    let stopped = false;
    let ws: WebSocket | null = null;

    const connect = async () => {
      if (stopped) return;
      console.log(`📡 Attempting connection to: ${WS_URL}`);
      try {
        ws = new WebSocket(WS_URL);
      } catch (err) {
        console.error("🔥 Error creating WebSocket:", err);
        setConnected(false);
        return;
      }
      wsRef.current = ws;

      ws.onopen = () => {
        console.log("✅ WebSocket connected");
        setConnected(true);
        setError(null);
        const joinReq = { v: 1, t: "JOIN_REQUEST", id: crypto.randomUUID(), body: { roomId, token: tokenRef.current } };
        ws?.send(JSON.stringify(joinReq));
      };

      ws.onclose = (ev) => {
        console.warn(`❌ WebSocket closed (code=${ev.code}). Reconnecting in 3s...`);
        setConnected(false);
        if (!stopped) setTimeout(connect, 3000);
      };

      ws.onerror = (ev) => {
        console.warn("❌ WebSocket error (likely untrusted cert):", ev);
        setConnected(false);
      };

      ws.onmessage = async (ev) => {
        let msg: any;
        try {
          msg = JSON.parse(typeof ev.data === "string" ? ev.data : "");
        } catch { return; }
        if (msg?.v !== 1 || typeof msg?.t !== "string") return;

        const body = msg.body;

        if (msg.t === "JOINED") {
          setLabel(body.label);
          setParticipants(body.participants);
          if (body.nextToken) {
            tokenRef.current = body.nextToken;
            console.log("🔄 Rotated join token for next reconnect");
          }
          console.log(`✅ Joined as ${body.label}`);
        } else if (msg.t === "ROOM_STATS") {
          if (body.roomId === roomId) setParticipants(body.participants);
        } else if (msg.t === "ERROR") {
          setError(body.code);
          console.warn(`🚫 Server error: ${body.code}`);
        } else if (msg.t === "APP_MSG") {
          if (body.roomId !== roomId) return;
          const k = keyRef.current;
          if (!k) return;
          const p = await decryptJson<PlainChat>(k, body.ciphertextB64, "chat:v1");
          if (p) setMessages((prev) => [...prev.slice(-199), p]);
        } else if (msg.t === "HELLO") {
          console.log("👋 Server said HELLO");
        }
      };
    };

    (async () => {
      try {
        const key = await importRoomKeyFromSecret(secret);
        keyRef.current = key;
        connect();
      } catch (err: any) {
        console.error("❌ Crypto init failed:", err);
        setError(
          err?.message?.includes("secure context") || err?.message?.includes("crypto.subtle")
            ? "🔒 This app requires HTTPS. Please open it at https://localhost:4001 (not http://localhost:4000)."
            : `Crypto error: ${err?.message ?? err}`
        );
      }
    })();

    const beforeUnload = () => {
      wsRef.current?.close();
      setMessages([]);
      const s = secretRef.current;
      if (s) wipeBytes(s);
      secretRef.current = null;
      keyRef.current = null;
    };
    window.addEventListener("beforeunload", beforeUnload);

    return () => {
      stopped = true;
      window.removeEventListener("beforeunload", beforeUnload);
      ws?.close();
      wsRef.current = null;
      setMessages([]);
      const s = secretRef.current;
      if (s) wipeBytes(s);
      secretRef.current = null;
      keyRef.current = null;
    };
  }, [roomId, token, secret, router]);

  async function sendText(text: string) {
    const ws = wsRef.current;
    const key = keyRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN || !key) return;
    const payload: PlainChat = { type: "text", id: crypto.randomUUID(), ts: Date.now(), from: label, text };
    const ct = await encryptJson(key, payload, "chat:v1");
    ws.send(JSON.stringify({ v: 1, t: "APP_MSG", id: crypto.randomUUID(), body: { roomId, ciphertextB64: ct } }));
  }

  function onExit() {
    if (!confirm("Exit chat? This will permanently delete keys and messages from this browser session.")) return;
    router.replace("/");
  }

  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 16 }}>
      <section style={{ width: "100%", maxWidth: 720, border: "1px solid #202a33", borderRadius: 14, padding: 16, background: "rgba(10,14,20,0.6)", display: "grid", gap: 12 }}>
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700 }}>Room</div>
            <div style={{ fontSize: 12, color: "#9fb0c0" }}>
              {connected ? "Connected" : "Disconnected"} · {participants} participant(s) · You: {label}
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
            <button
              onClick={onExit}
              style={{ padding: "4px 10px", borderRadius: 8, border: "1px solid #ff7b72", background: "transparent", color: "#ff7b72", fontSize: 11, cursor: "pointer", fontWeight: 600 }}
            >
              Exit Chat
            </button>
            <div style={{ textAlign: "right", fontSize: 11, color: "#9fb0c0", maxWidth: 220 }}>
              Wipes keys & messages on close.
            </div>
          </div>
        </header>

        {error && <div style={{ color: "#ff7b72", fontSize: 12 }}>{error}</div>}

        <div style={{ height: "60vh", overflowY: "auto", border: "1px solid #202a33", borderRadius: 12, padding: 10, background: "#0b0f14" }}>
          {messages.length === 0 ? (
            <div style={{ color: "#9fb0c0", fontSize: 12 }}>No messages yet.</div>
          ) : (
            messages.map((m) => (
              <div key={m.id} style={{ padding: "4px 0", fontSize: 13 }}>
                <span style={{ color: "#9fb0c0", marginRight: 8, fontSize: 11 }}>{new Date(m.ts).toLocaleTimeString()}</span>
                <span style={{ color: "#e6edf3", fontWeight: 700, marginRight: 6 }}>{m.from}</span>
                <span style={{ color: "#e6edf3" }}>{m.text}</span>
              </div>
            ))
          )}
        </div>

        <Composer onSend={sendText} disabled={!connected} />

        {!connected && (
          <div style={{ marginTop: 12, padding: 12, border: "1px solid #dba642", borderRadius: 8, background: "rgba(219, 166, 66, 0.1)", color: "#dba642", fontSize: 13 }}>
            <strong>Connection Failed?</strong><br />
            1. Ensure the server is running.<br />
            2. You must trust the backend certificate manually:<br />
            <a href={healthUrl} target="_blank" rel="noopener noreferrer" style={{ color: "#dba642", textDecoration: "underline", fontWeight: "bold" }}>
              CLICK HERE to open Backend API in a new tab
            </a><br />
            (Then in the new tab: click Advanced -&gt; Proceed)<br />
            3. After you see "ok": true, come back here and refresh this page.
          </div>
        )}
      </section>
    </main>
  );
}

function Composer({ onSend, disabled }: { onSend: (t: string) => void; disabled: boolean }) {
  const [value, setValue] = useState("");
  return (
    <form
      style={{ display: "flex", gap: 8 }}
      onSubmit={(e) => {
        e.preventDefault();
        const v = value.trim();
        if (!v) return;
        onSend(v);
        setValue("");
      }}
    >
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        disabled={disabled}
        placeholder="Message"
        autoComplete="off"
        style={{ flex: 1, padding: "10px 12px", borderRadius: 10, border: "1px solid #202a33", background: "#0b0f14", color: "#e6edf3" }}
      />
      <button
        type="submit"
        disabled={disabled}
        style={{ padding: "10px 12px", borderRadius: 10, border: "0", background: disabled ? "#30363d" : "#e6edf3", color: disabled ? "#9fb0c0" : "#0b0f14", fontWeight: 700 }}
      >
        Send
      </button>
    </form>
  );
}

