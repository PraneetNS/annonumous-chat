"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import { b64urlEncode, randomBytes } from "../lib/crypto";

// Dynamic API URL
const getApiBase = () => {
  if (process.env.NEXT_PUBLIC_API_BASE) return process.env.NEXT_PUBLIC_API_BASE;
  if (typeof window === "undefined") return "https://localhost:3001";

  const hostname = window.location.hostname;
  const port = window.location.port;
  const protocol = window.location.protocol;

  if (port === "3000" && protocol === "https:") return `https://${hostname}:4001/api`;
  if (port === "4000" || port === "4001") return "/api";
  if (hostname.includes("loca.lt") || hostname.includes("ngrok") ||
    hostname.includes("trycloudflare.com") || hostname.includes("serveo.net")) return "/api";
  return `https://${hostname}:3001`;
};

const API_BASE = getApiBase();

type CreateRoomResp = { roomId: string; fingerprint: string; networkIp?: string };
type TokenResp = { roomId: string; token: string; expUnixMs: number };

/** Detect current access type from window.location */
function detectAccessType(): "tunnel" | "network" | "localhost" {
  if (typeof window === "undefined") return "localhost";
  const h = window.location.hostname;
  if (h.includes("trycloudflare.com") || h.includes("ngrok") ||
    h.includes("loca.lt") || h.includes("serveo.net")) return "tunnel";
  if (h !== "localhost" && h !== "127.0.0.1") return "network";
  return "localhost";
}

export default function Page() {
  const [roomId, setRoomId] = useState<string | null>(null);
  const [fingerprint, setFingerprint] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [exp, setExp] = useState<number | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [roomSecretB64, setRoomSecretB64] = useState<string | null>(null);
  const [networkIp, setNetworkIp] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tunnelUrl, setTunnelUrl] = useState<string | null>(null);
  const [tunnelChecked, setTunnelChecked] = useState(false);
  const [urlType, setUrlType] = useState<"tunnel" | "network" | "localhost">("localhost");
  const tunnelPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Poll for Cloudflare tunnel URL ────────────────────────────────────────
  useEffect(() => {
    const fetchTunnel = async () => {
      try {
        const res = await fetch("/api/tunnel-url", { cache: "no-store" });
        if (res.ok) {
          const j = await res.json();
          if (j.tunnelUrl) {
            setTunnelUrl(j.tunnelUrl);
          }
        }
      } catch { }
      setTunnelChecked(true);
    };

    // Poll every 3 seconds until we get a tunnel URL
    fetchTunnel();
    tunnelPollRef.current = setInterval(async () => {
      if (tunnelUrl) {
        clearInterval(tunnelPollRef.current!);
        return;
      }
      await fetchTunnel();
    }, 3000);

    return () => {
      if (tunnelPollRef.current) clearInterval(tunnelPollRef.current);
    };
  }, [tunnelUrl]);

  // ── Build the join URL ─────────────────────────────────────────────────────
  const joinUrl = useMemo(() => {
    if (!roomId || !token || !roomSecretB64) return null;

    let origin: string;
    let type: "tunnel" | "network" | "localhost";

    const currentType = detectAccessType();

    if (currentType === "tunnel") {
      // Already on tunnel — use current origin
      origin = typeof window !== "undefined" ? window.location.origin : "";
      type = "tunnel";
    } else if (tunnelUrl) {
      // Tunnel is running — always prefer it for global access
      origin = tunnelUrl;
      type = "tunnel";
    } else if (networkIp && (typeof window === "undefined" ||
      window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1")) {
      // Fall back to local network IP
      origin = `http://${networkIp}:4000`;
      type = "network";
    } else {
      origin = typeof window !== "undefined" ? window.location.origin : "";
      type = currentType;
    }

    setUrlType(type);

    const u = new URL("/join", origin);
    u.searchParams.set("roomId", roomId);
    u.searchParams.set("token", token);
    u.hash = `k=${roomSecretB64}`;
    return u.toString();
  }, [roomId, token, roomSecretB64, networkIp, tunnelUrl]);

  async function refreshToken(rid: string) {
    const res = await fetch(`${API_BASE}/rooms/${encodeURIComponent(rid)}/token`, { cache: "no-store" });
    if (!res.ok) throw new Error("token fetch failed");
    const j = (await res.json()) as TokenResp;
    setToken(j.token);
    setExp(j.expUnixMs);
  }

  async function renderQr(url: string) {
    const dataUrl = await QRCode.toDataURL(url, { margin: 1, width: 260, errorCorrectionLevel: "M" });
    setQrDataUrl(dataUrl);
  }

  async function onCreate() {
    setError(null);
    setQrDataUrl(null);
    setRoomId(null);
    setFingerprint(null);
    setToken(null);
    setExp(null);
    setNetworkIp(null);

    const secret = randomBytes(32);
    setRoomSecretB64(b64urlEncode(secret.buffer));

    const res = await fetch(`${API_BASE}/rooms`, { method: "POST" });
    if (!res.ok) { setError("Failed to create room"); return; }
    const j = (await res.json()) as CreateRoomResp;
    setRoomId(j.roomId);
    setFingerprint(j.fingerprint);
    if (j.networkIp) setNetworkIp(j.networkIp);
  }

  useEffect(() => {
    if (!roomId) return;
    let stopped = false;
    const run = async () => {
      try { await refreshToken(roomId); }
      catch { if (!stopped) setError("Failed to get join token"); }
    };
    void run();
    const interval = setInterval(() => void run(), 60_000);
    return () => { stopped = true; clearInterval(interval); };
  }, [roomId]);

  useEffect(() => {
    if (!joinUrl) return;
    void renderQr(joinUrl);
  }, [joinUrl]);

  // ── Styles ─────────────────────────────────────────────────────────────────
  const s = {
    main: {
      minHeight: "100vh",
      display: "grid",
      placeItems: "center",
      padding: 16,
      background: "linear-gradient(135deg, #0b0f14 0%, #0d1520 100%)",
      fontFamily: "'Inter', 'Segoe UI', sans-serif",
    } as React.CSSProperties,
    card: {
      width: "100%",
      maxWidth: 540,
      border: "1px solid #1e2d3d",
      borderRadius: 20,
      padding: "28px 24px",
      background: "rgba(10,14,20,0.85)",
      backdropFilter: "blur(12px)",
      boxShadow: "0 8px 48px rgba(0,0,0,0.5)",
      display: "grid",
      gap: 16,
    } as React.CSSProperties,
  };

  const badgeStyle = (type: "tunnel" | "network" | "localhost"): React.CSSProperties => ({
    padding: "12px 16px",
    borderRadius: 12,
    fontSize: 13,
    lineHeight: 1.6,
    border: type === "tunnel" ? "1px solid #3fb950"
      : type === "network" ? "1px solid #58a6ff"
        : "1px solid #dba642",
    background: type === "tunnel" ? "rgba(63,185,80,0.08)"
      : type === "network" ? "rgba(88,166,255,0.08)"
        : "rgba(219,166,66,0.08)",
    color: type === "tunnel" ? "#3fb950"
      : type === "network" ? "#58a6ff"
        : "#dba642",
  });

  return (
    <main style={s.main}>
      <section style={s.card}>
        {/* Header */}
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: "#e6edf3", letterSpacing: "-0.5px" }}>
            🔐 Ephemeral Chat
          </h1>
          <p style={{ marginTop: 6, marginBottom: 0, color: "#7d8fa0", fontSize: 13, lineHeight: 1.5 }}>
            No accounts. No logs. Keys wiped when you close the tab.
          </p>
        </div>

        {/* Tunnel status banner */}
        {tunnelChecked && (
          <div style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "8px 12px",
            borderRadius: 10,
            fontSize: 12,
            background: tunnelUrl ? "rgba(63,185,80,0.08)" : "rgba(219,166,66,0.08)",
            border: tunnelUrl ? "1px solid #3fb95040" : "1px solid #dba64240",
            color: tunnelUrl ? "#3fb950" : "#dba642",
          }}>
            <span style={{ fontSize: 16 }}>{tunnelUrl ? "🌍" : "⏳"}</span>
            <span>
              {tunnelUrl
                ? <>Global tunnel active — <strong>anyone can join from any network</strong></>
                : "Starting Cloudflare tunnel… (takes ~10 seconds)"}
            </span>
          </div>
        )}

        {/* Create Room button */}
        <button
          onClick={onCreate}
          style={{
            padding: "12px 20px",
            borderRadius: 12,
            border: "0",
            background: "linear-gradient(135deg, #238636, #2ea043)",
            color: "#fff",
            fontWeight: 700,
            fontSize: 15,
            cursor: "pointer",
            transition: "opacity 0.15s",
            letterSpacing: "0.2px",
          }}
          onMouseOver={e => (e.currentTarget.style.opacity = "0.85")}
          onMouseOut={e => (e.currentTarget.style.opacity = "1")}
        >
          + Create Room
        </button>

        {error && <p style={{ color: "#ff7b72", fontSize: 12, margin: 0 }}>{error}</p>}

        {roomId && (
          <div style={{ display: "grid", gap: 12 }}>
            {/* Room info */}
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#7d8fa0" }}>
              <span>Room: <span style={{ color: "#e6edf3", fontFamily: "monospace" }}>{roomId.slice(0, 12)}…</span></span>
              <span>Token expires: <span style={{ color: "#e6edf3" }}>{exp ? new Date(exp).toLocaleTimeString() : "…"}</span></span>
            </div>

            {/* QR Code */}
            {qrDataUrl ? (
              <div style={{
                display: "grid",
                placeItems: "center",
                padding: 16,
                border: "1px solid #1e2d3d",
                borderRadius: 16,
                background: "#fff",
              }}>
                <img src={qrDataUrl} alt="Join QR" width={260} height={260} style={{ display: "block" }} />
              </div>
            ) : (
              <div style={{
                height: 292,
                display: "grid",
                placeItems: "center",
                border: "1px solid #1e2d3d",
                borderRadius: 16,
                color: "#7d8fa0",
                fontSize: 13,
              }}>
                Generating QR code…
              </div>
            )}

            {/* Access type badge */}
            {joinUrl && (
              <>
                <div style={badgeStyle(urlType)}>
                  {urlType === "tunnel" ? (
                    <>
                      <strong>✅ GLOBAL ACCESS</strong> — This QR works from <strong>ANY network!</strong><br />
                      WiFi, 4G, 5G, different city — anyone can scan and join instantly.
                    </>
                  ) : urlType === "network" ? (
                    <>
                      <strong>📱 LOCAL NETWORK</strong> — Works on your WiFi only.<br />
                      Tunnel is still starting… refresh in a moment for global access. (IP: {networkIp})
                    </>
                  ) : (
                    <>
                      <strong>⚠️ LOCALHOST ONLY</strong> — This QR won't work on other devices.<br />
                      Tunnel is starting… wait a few seconds and the QR will update automatically.
                    </>
                  )}
                </div>

                {/* Join link */}
                <div style={{ fontSize: 11, color: "#4d6070" }}>
                  <div style={{ marginBottom: 4, color: "#7d8fa0" }}>Join link:</div>
                  <a
                    href={joinUrl}
                    style={{ color: "#58a6ff", wordBreak: "break-all", textDecoration: "none" }}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {joinUrl}
                  </a>
                </div>

                {/* Keep open warning */}
                <div style={{
                  padding: "10px 14px",
                  borderRadius: 10,
                  background: "rgba(219,166,66,0.07)",
                  border: "1px solid #dba64230",
                  color: "#dba642",
                  fontSize: 12,
                }}>
                  ⚠️ <strong>Keep this tab open!</strong> The room disappears when you navigate away.
                </div>
              </>
            )}
          </div>
        )}
      </section>
    </main>
  );
}
