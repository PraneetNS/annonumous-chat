"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { b64urlDecode } from "../../lib/crypto";

// Dynamic API URL: detects current hostname and uses appropriate endpoint
const getApiBase = () => {
  if (process.env.NEXT_PUBLIC_API_BASE) return process.env.NEXT_PUBLIC_API_BASE;
  if (typeof window === "undefined") return "https://localhost:3001";

  const hostname = window.location.hostname;
  const port = window.location.port;
  const protocol = window.location.protocol;

  // If we are on port 3000 (HTTPS frontend), use HTTPS proxy on 4001
  if (port === "3000" && protocol === "https:") {
    return `https://${hostname}:4001/api`;
  }

  // If we are on port 4000 (HTTP proxy) or 4001 (HTTPS proxy), use /api
  if (port === "4000" || port === "4001") {
    return "/api";
  }

  // If on a tunnel service, use relative /api
  if (hostname.includes("loca.lt") || hostname.includes("ngrok") ||
    hostname.includes("trycloudflare.com") || hostname.includes("serveo.net")) {
    return "/api";
  }

  // Default: use backend directly
  return `https://${hostname}:3001`;
};

const API_BASE = getApiBase();

export default function JoinClient() {
  const sp = useSearchParams();
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const roomId = sp.get("roomId");
  const urlToken = sp.get("token");

  const secretOk = useMemo(() => {
    if (typeof window === "undefined") return false;
    const hash = window.location.hash.slice(1);
    const params = new URLSearchParams(hash);
    const k = params.get("k");
    if (!k) return false;
    try {
      const b = b64urlDecode(k);
      return b.byteLength === 32;
    } catch {
      return false;
    }
  }, []);

  useEffect(() => {
    async function startJoin() {
      setErr(null);
      if (!roomId) {
        setErr("Missing roomId");
        setLoading(false);
        return;
      }
      if (!secretOk) {
        setErr("Missing encryption key");
        setLoading(false);
        return;
      }

      try {
        // EXTREMELY IMPORTANT: Fetch a FRESH token for this specific device.
        // This avoids ERR_TOKEN_REPLAY if the token in the URL was already used.
        console.log(`📡 Fetching fresh token for room ${roomId}...`);
        const res = await fetch(`${API_BASE}/rooms/${encodeURIComponent(roomId)}/token`, { cache: "no-store" });

        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j.code || "Failed to get join token");
        }

        const { token: freshToken } = await res.json();
        const k = new URLSearchParams(window.location.hash.slice(1)).get("k") ?? "";

        // Redirect with the fresh, unique token
        router.replace(`/chat?roomId=${encodeURIComponent(roomId)}&token=${encodeURIComponent(freshToken)}#k=${encodeURIComponent(k)}`);
      } catch (err: any) {
        console.error("Join error:", err);
        setErr(err.message || "Failed to join room");
        setLoading(false);
      }
    }

    startJoin();
  }, [roomId, secretOk, router]);

  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 16 }}>
      <section style={{ width: "100%", maxWidth: 520, border: "1px solid #202a33", borderRadius: 14, padding: 24, background: "rgba(10,14,20,0.6)", backdropFilter: "blur(10px)", textAlign: "center" }}>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, background: "linear-gradient(135deg, #58a6ff, #bc8cff)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
          {loading ? "Authenticating Session..." : "Join Error"}
        </h1>

        {loading ? (
          <div style={{ marginTop: 20 }}>
            <p style={{ color: "#9fb0c0", fontSize: 14 }}>Preparing secure end-to-end encrypted room...</p>
            <div className="loader" style={{ marginTop: 20, marginInline: "auto" }}></div>
          </div>
        ) : (
          <div style={{ marginTop: 20 }}>
            <p style={{ color: "#ff7b72", fontSize: 14, fontWeight: 500 }}>{err}</p>
            <button
              onClick={() => router.push("/")}
              style={{ marginTop: 20, padding: "8px 16px", borderRadius: 8, border: "1px solid #30363d", background: "#21262d", color: "#c9d1d9", cursor: "pointer" }}
            >
              Back Home
            </button>
          </div>
        )}

        <style>{`
          .loader {
            width: 24px;
            height: 24px;
            border: 3px solid #30363d;
            border-top: 3px solid #58a6ff;
            border-radius: 50%;
            animation: spin 1s linear infinite;
            display: inline-block;
          }
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        `}</style>
      </section>
    </main>
  );
}

