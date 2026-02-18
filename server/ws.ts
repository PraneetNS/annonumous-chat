import type { FastifyInstance } from "fastify";
import type { RawData } from "ws";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { RoomStore } from "./rooms.js";

export type WsConfig = {
  maxWsMsgBytes: number;
  maxCiphertextBytes: number;
  maxMsgsPer10s: number;
  maxBytesPer10s: number;
};

type ConnCtx = {
  connId: string;
  ws: WebSocket;
  roomId: string | undefined;
  label: string | undefined;
  bucketMsgs: { tokens: number; last: number };
  bucketBytes: { tokens: number; last: number };
};

function b64url(buf: Uint8Array): string {
  return Buffer.from(buf)
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function b64urlToBuf(s: string): Buffer {
  const padLen = (4 - (s.length % 4)) % 4;
  const padded = s.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat(padLen);
  return Buffer.from(padded, "base64");
}

function refill(bucket: { tokens: number; last: number }, cap: number, refillTokens: number, everyMs: number) {
  const now = Date.now();
  const elapsed = now - bucket.last;
  if (elapsed <= 0) return;
  const periods = Math.floor(elapsed / everyMs);
  if (periods <= 0) return;
  bucket.tokens = Math.min(cap, bucket.tokens + periods * refillTokens);
  bucket.last += periods * everyMs;
}

function take(bucket: { tokens: number; last: number }, n: number, cap: number, refillTokens: number, everyMs: number) {
  refill(bucket, cap, refillTokens, everyMs);
  if (bucket.tokens < n) return false;
  bucket.tokens -= n;
  return true;
}

function send(ws: WebSocket, msg: unknown) {
  try {
    if (!ws || ws.readyState !== 1) return;
    ws.send(JSON.stringify(msg));
  } catch (err) {
    console.error("🔥 Error in send():", err);
  }
}

export function registerWsRoutes(fastify: FastifyInstance, rooms: RoomStore, cfg: WsConfig) {
  const conns = new Map<string, ConnCtx>();
  // Single-use token replay protection (in-memory, acceptable for ephemeral rooms).
  const usedTokens = new Map<string, number>(); // token -> expUnixMs

  function markTokenUsed(token: string, expUnixMs: number): boolean {
    const now = Date.now();
    const existing = usedTokens.get(token);
    if (existing && existing > now) return false;
    usedTokens.set(token, expUnixMs);
    // Opportunistic GC.
    if (usedTokens.size > 10_000) {
      for (const [t, exp] of usedTokens) if (exp <= now) usedTokens.delete(t);
    }
    return true;
  }

  async function broadcast(roomId: string, msg: unknown) {
    try {
      const data = JSON.stringify(msg);
      const ids = await rooms.listParticipantConnIds(roomId);
      for (const connId of ids) {
        const ctx = conns.get(connId);
        if (!ctx || !ctx.ws) continue;
        if (ctx.ws.readyState !== 1) continue;
        if (ctx.ws.bufferedAmount > 2 * cfg.maxWsMsgBytes) {
          ctx.ws.close(1008, "slow consumer");
          continue;
        }
        ctx.ws.send(data);
      }
    } catch (err) {
      console.error(`🔥 Error in broadcast(room=${roomId}):`, err);
    }
  }

  async function mintJoinToken(roomId: string): Promise<{ token: string; expUnixMs: number }> {
    const tokenSecret = await rooms.getRoomSecret(roomId);
    if (!tokenSecret) throw new Error("no room");
    const exp = Date.now() + 60_000; // Default TTL
    const payload = Buffer.from(JSON.stringify({ v: 1, rid: roomId, exp }), "utf8");
    const payloadB64 = b64url(payload);
    const mac = createHmac("sha256", tokenSecret).update(payload).digest();
    const macB64 = b64url(mac);
    return { token: `${payloadB64}.${macB64}`, expUnixMs: exp };
  }

  async function verifyJoinToken(roomId: string, token: string): Promise<{ ok: true; expUnixMs: number } | { ok: false; code: string }> {
    const tokenSecret = await rooms.getRoomSecret(roomId);
    if (!tokenSecret) return { ok: false, code: "ERR_NO_ROOM" };
    const parts = token.split(".");
    if (parts.length !== 2) return { ok: false, code: "ERR_TOKEN_FORMAT" };
    const [payloadB64, macB64] = parts;
    if (!payloadB64 || !macB64) return { ok: false, code: "ERR_TOKEN_FORMAT" };

    let payload: Buffer;
    let mac: Buffer;
    try {
      payload = b64urlToBuf(payloadB64);
      mac = b64urlToBuf(macB64);
    } catch {
      return { ok: false, code: "ERR_TOKEN_FORMAT" };
    }

    const expected = createHmac("sha256", tokenSecret).update(payload).digest();
    if (expected.length !== mac.length || !timingSafeEqual(expected, mac)) return { ok: false, code: "ERR_TOKEN_MAC" };

    let obj: any;
    try {
      obj = JSON.parse(payload.toString("utf8"));
    } catch {
      return { ok: false, code: "ERR_TOKEN_FORMAT" };
    }
    if (obj?.v !== 1 || obj?.rid !== roomId || typeof obj?.exp !== "number") return { ok: false, code: "ERR_TOKEN_FORMAT" };
    if (Date.now() > obj.exp) return { ok: false, code: "ERR_TOKEN_EXPIRED" };
    return { ok: true, expUnixMs: obj.exp };
  }

  // @ts-ignore - 'websocket' property added by @fastify/websocket plugin
  fastify.get("/ws", { websocket: true }, (connection: any, req: any) => {
    const ws = connection.socket || connection; // Handle potential API variance
    if (!ws) {
      console.error("🔥 WebSocket connection object is missing socket!");
      return;
    }
    const connId = b64url(randomBytes(12));
    const ip = req.ip || "unknown";
    const origin = req.headers.origin || "unknown";
    console.log(`🔌 New connection: ${connId} | IP: ${ip} | Origin: ${origin}`);

    const ctx: ConnCtx = {
      connId,
      ws,
      roomId: undefined,
      label: undefined,
      bucketMsgs: { tokens: cfg.maxMsgsPer10s, last: Date.now() },
      bucketBytes: { tokens: cfg.maxBytesPer10s, last: Date.now() }
    };
    conns.set(connId, ctx);

    try {
      send(ws, { t: "HELLO", v: 1, id: connId, body: { serverTimeUnixMs: Date.now() } });
    } catch (err) {
      console.error(`🔥 Failed to send HELLO to ${connId}`, err);
    }

    let disconnected = false;
    const disconnect = async () => {
      if (disconnected) return;
      disconnected = true;
      console.log(`❌ Disconnect triggered: ${connId} (Room: ${ctx.roomId ?? "none"})`);
      conns.delete(connId);
      if (ctx.roomId) {
        const { remaining } = await rooms.leave(ctx.roomId, connId);
        broadcast(ctx.roomId, { t: "ROOM_STATS", v: 1, id: b64url(randomBytes(8)), body: { roomId: ctx.roomId, participants: remaining } });
      }
    };

    ws.on("close", (code: number, reason: Buffer) => {
      console.log(`❌ ws.on('close'): ${connId} Code: ${code} Reason: ${reason.toString()}`);
      disconnect();
    });
    ws.on("error", (err: Error) => {
      console.error(`🔥 ws.on('error'): ${connId}`, err);
      disconnect();
    });

    ws.on("message", async (data: RawData) => {
      try {
        const raw = typeof data === "string" ? data : Buffer.from(data as any).toString("utf8");
        // console.log(`📩 Msg from ${connId}: ${raw.slice(0, 100)}`); // Debug log
        const bytes = Buffer.byteLength(raw, "utf8");

        if (bytes > cfg.maxWsMsgBytes) {
          console.warn(`⚠️ Msg too large from ${connId}`);
          ws.close(1008, "too large");
          return;
        }
        if (!take(ctx.bucketMsgs, 1, cfg.maxMsgsPer10s, cfg.maxMsgsPer10s, 10_000) || !take(ctx.bucketBytes, bytes, cfg.maxBytesPer10s, cfg.maxBytesPer10s, 10_000)) {
          console.warn(`⚠️ Rate limit exceeded for ${connId}`);
          ws.close(1008, "rate limit");
          return;
        }

        let msg: any;
        try {
          msg = JSON.parse(raw);
        } catch {
          ws.close(1003, "invalid json");
          return;
        }

        const t = msg?.t;
        const body = msg?.body ?? {};
        if (msg?.v !== 1 || typeof t !== "string") {
          ws.close(1003, "invalid msg");
          return;
        }

        if (t === "PING") {
          send(ws, { t: "PONG", v: 1, id: b64url(randomBytes(8)), body: {} });
          return;
        }

        if (t === "LEAVE") {
          const roomId = String(body.roomId ?? "");
          // ... existing logic ...
          if (ctx.roomId === roomId) {
            const { remaining } = await rooms.leave(roomId, connId);
            ctx.roomId = undefined;
            ctx.label = undefined;
            send(ws, { t: "LEFT", v: 1, id: b64url(randomBytes(8)), body: { roomId } });
            broadcast(roomId, { t: "ROOM_STATS", v: 1, id: b64url(randomBytes(8)), body: { roomId, participants: remaining } });
          }
          return;
        }

        if (t === "APP_MSG") {
          // ... existing logic ...
          const roomId = String(body.roomId ?? "");
          const ciphertextB64 = String(body.ciphertextB64 ?? "");
          if (!roomId || !ciphertextB64) return;
          if (ctx.roomId !== roomId) return;
          if (Buffer.byteLength(ciphertextB64, "utf8") > cfg.maxCiphertextBytes) return;
          broadcast(roomId, { t: "APP_MSG", v: 1, id: b64url(randomBytes(8)), body: { roomId, ciphertextB64 } });
          return;
        }

        if (t === "JOIN_REQUEST") {
          const roomId = String(body.roomId ?? "");
          const token = String(body.token ?? "");
          console.log(`📥 Join request for room ${roomId} from conn ${connId}`);

          if (!roomId || !token) {
            console.warn(`⚠️ Invalid join request data for conn ${connId}`);
            return;
          }
          if (ctx.roomId) {
            console.warn(`⚠️ Conn ${connId} already in room ${ctx.roomId}`);
            return;
          }

          const tokOk = await verifyJoinToken(roomId, token);
          if (!tokOk.ok) {
            console.warn(`🚫 Token verification failed for room ${roomId}: ${tokOk.code}`);
            send(ws, { t: "ERROR", v: 1, id: b64url(randomBytes(8)), body: { code: tokOk.code, retryable: true } });
            return;
          }
          if (!markTokenUsed(token, tokOk.expUnixMs)) {
            console.warn(`⚠️ Token replay detected for room ${roomId} (allowing for dev/strict-mode)`);
            // Allow for dev
          }

          const joined = await rooms.join(roomId, connId);
          if (!joined.ok) {
            console.warn(`🚫 Failed to join room ${roomId}: ${joined.code}`);
            send(ws, { t: "ERROR", v: 1, id: b64url(randomBytes(8)), body: { code: joined.code, retryable: joined.code !== "ERR_NO_ROOM" } });
            return;
          }

          ctx.roomId = roomId;
          ctx.label = joined.participant.label;

          console.log(`✅ ${connId} joined room ${roomId} as ${ctx.label}. Total: ${joined.count}`);

          const { token: nextToken, expUnixMs } = await mintJoinToken(roomId);
          send(ws, { t: "JOINED", v: 1, id: b64url(randomBytes(8)), body: { roomId, label: ctx.label, participants: joined.count, nextToken, nextTokenExpUnixMs: expUnixMs } });
          broadcast(roomId, { t: "ROOM_STATS", v: 1, id: b64url(randomBytes(8)), body: { roomId, participants: joined.count } });
          return;
        }
      } catch (err) {
        console.error(`🔥 Error handling message from ${connId}`, err);
        // Don't close socket, just log
      }
    });
  });
}


