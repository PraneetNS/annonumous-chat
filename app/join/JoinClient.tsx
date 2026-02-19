"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { b64urlDecode } from "../../lib/crypto";

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

export default function JoinClient() {
  const sp = useSearchParams();
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState("");
  const [step, setStep] = useState<"name" | "auth">("name");

  const roomId = sp.get("roomId");

  const secretOk = useMemo(() => {
    if (typeof window === "undefined") return false;
    const hash = window.location.hash.slice(1);
    const params = new URLSearchParams(hash);
    const k = params.get("k");
    if (!k) return false;
    try {
      const b = b64urlDecode(k);
      return b.byteLength === 32;
    } catch { return false; }
  }, []);

  async function startJoin() {
    setErr(null);
    if (!roomId) { setErr("Missing roomId"); return; }
    if (!secretOk) { setErr("Missing encryption key"); return; }
    if (!name.trim()) { setErr("Please enter your name"); return; }

    setLoading(true);
    setStep("auth");

    try {
      console.log(`📡 Fetching fresh token for room ${roomId}...`);
      const res = await fetch(`${API_BASE}/rooms/${encodeURIComponent(roomId)}/token`, { cache: "no-store" });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.code || "Failed to get join token");
      }
      const { token: freshToken } = await res.json();
      const k = new URLSearchParams(window.location.hash.slice(1)).get("k") ?? "";

      // Redirect with name and token
      router.replace(`/chat?roomId=${encodeURIComponent(roomId)}&token=${encodeURIComponent(freshToken)}&name=${encodeURIComponent(name.trim())}#k=${encodeURIComponent(k)}`);
    } catch (err: any) {
      console.error("Join error:", err);
      setErr(err.message || "Failed to join room");
      setLoading(false);
      setStep("name"); // Go back to name input on error
    }
  }

  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 16 }}>
      <section style={{ width: "100%", maxWidth: 520, border: "1px solid #202a33", borderRadius: 14, padding: 24, background: "rgba(10,14,20,0.6)", backdropFilter: "blur(10px)", textAlign: "center" }}>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, background: "linear-gradient(135deg, #58a6ff, #bc8cff)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
          {step === "name" ? "Welcome to Chat" : "Authenticating Session..."}
        </h1>

        {step === "name" ? (
          <div style={{ marginTop: 24 }}>
            <p style={{ color: "#9fb0c0", fontSize: 14, marginBottom: 20 }}>Please enter your name to join the secure room.</p>
            <form onSubmit={(e) => { e.preventDefault(); startJoin(); }} style={{ display: "grid", gap: 12 }}>
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your Name"
                style={{ padding: "12px 16px", borderRadius: 10, border: "1px solid #30363d", background: "#0b0f14", color: "#e6edf3", fontSize: 16, textAlign: "center" }}
              />
              <button
                type="submit"
                style={{ padding: "12px", borderRadius: 10, border: "0", background: "#e6edf3", color: "#0b0f14", fontWeight: 700, fontSize: 16, cursor: "pointer" }}
              >
                Join Chat
              </button>
            </form>
            {err && <p style={{ color: "#ff7b72", fontSize: 13, marginTop: 12 }}>{err}</p>}
          </div>
        ) : (
          <div style={{ marginTop: 20 }}>
            <p style={{ color: "#9fb0c0", fontSize: 14 }}>Preparing secure end-to-end encrypted room...</p>
            <div className="loader" style={{ marginTop: 20, marginInline: "auto" }}></div>
            {err && <p style={{ color: "#ff7b72", fontSize: 13, marginTop: 12 }}>{err}</p>}
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
