import type { FastifyInstance } from "fastify";
import type { WebSocket, RawData } from "ws";
import { randomIdB64Url } from "../utils/base64url.js";
import { RoomStore } from "../rooms/roomStore.js";
import { mintJoinToken, verifyJoinToken } from "../security/joinTokens.js";
import { TokenBucket, IpConnectionLimiter, GlobalConnectionLimiter } from "../security/rateLimit.js";
import { AppMsgSchema, JoinRequestSchema, LeaveSchema, MediaMsgSchema, PingSchema, RoomCreateSchema, WsEnvelopeSchema, type ClientMsg } from "./types.js";
import { getMetrics } from "../observability/metrics.js";

type ConnCtx = {
  connId: string;
  ip: string;
  ws: WebSocket;
  roomId: string | undefined;
  label: string | undefined;
  msgBucket: TokenBucket;
  bytesBucket: TokenBucket;
  /** Last pong received — used to detect dead connections */
  lastPongMs: number;
  /** Whether we're waiting for a pong */
  awaitingPong: boolean;
};

type LocalRoom = {
  roomId: string;
  conns: Set<string>;
  qrToken: string;
  qrExpUnixMs: number;
  qrTimer: NodeJS.Timeout;
};

const WS_CLOSE_POLICY_VIOLATION = 1008;
const WS_CLOSE_UNSUPPORTED_DATA = 1003;
const WS_CLOSE_GOING_AWAY = 1001;

// In-process routing state (required to fanout messages).
const connections = new Map<string, ConnCtx>();
const localRooms = new Map<string, LocalRoom>();

export interface WsCallbacks {
  onConnect?: () => void;
  onDisconnect?: () => void;
}

export function registerWs(fastify: FastifyInstance, callbacks?: WsCallbacks) {
  const config = (fastify as any).config;
  const metrics = getMetrics();
  const roomStore = new RoomStore({
    redis: (fastify as any).redis,
    ttlMs: config.ROOM_KEY_TTL_MS,
    maxParticipants: config.ROOM_MAX_PARTICIPANTS
  });

  const ipLimiter = new IpConnectionLimiter(config.MAX_CONNS_PER_IP);
  const globalLimiter = new GlobalConnectionLimiter(config.MAX_TOTAL_CONNECTIONS);

  // ── Ping / keepalive ────────────────────────────────────────────────────────
  // Sends a WS ping frame every WS_PING_INTERVAL_MS.
  // If a pong hasn't come back within WS_PING_TIMEOUT_MS, the connection is dead.
  const PING_INTERVAL = config.WS_PING_INTERVAL_MS ?? 30_000;
  const PING_TIMEOUT = config.WS_PING_TIMEOUT_MS ?? 10_000;

  const pingTimer = setInterval(() => {
    const now = Date.now();
    for (const [, ctx] of connections) {
      if (ctx.ws.readyState !== 1 /* OPEN */) continue;

      if (ctx.awaitingPong && now - ctx.lastPongMs > PING_TIMEOUT) {
        // Dead connection — terminate it
        fastify.log.warn({ connId: ctx.connId }, "ws: dead connection terminated (ping timeout)");
        metrics.incrementCounter("ws_dead_connections");
        ctx.ws.terminate();
        continue;
      }

      ctx.awaitingPong = true;
      ctx.ws.ping();
    }
  }, PING_INTERVAL).unref(); // .unref() so it doesn't prevent process exit

  // Clean up ping timer on server close
  fastify.addHook("onClose", async () => {
    clearInterval(pingTimer);
  });

  // ── Helpers ─────────────────────────────────────────────────────────────────

  function wsSend(ctx: ConnCtx, msg: unknown) {
    if (ctx.ws.readyState !== 1) return;
    // Slow-consumer protection: drop if send buffer is too full
    if (ctx.ws.bufferedAmount > config.MAX_WS_MSG_BYTES * 4) {
      metrics.incrementCounter("ws_slow_consumer_drops");
      return;
    }
    ctx.ws.send(JSON.stringify(msg));
  }

  /**
   * Non-blocking broadcast using setImmediate to yield between sends.
   * Prevents a large room from blocking the event loop for other connections.
   */
  function broadcast(roomId: string, msg: unknown) {
    const r = localRooms.get(roomId);
    if (!r || r.conns.size === 0) return;

    const data = JSON.stringify(msg);
    const connIds = Array.from(r.conns);
    let i = 0;

    const sendNext = () => {
      // Process up to 50 sends per tick to balance throughput vs latency
      const end = Math.min(i + 50, connIds.length);
      while (i < end) {
        const id = connIds[i++];
        if (id === undefined) continue;
        const ctx = connections.get(id);
        if (!ctx || ctx.ws.readyState !== 1) continue;
        if (ctx.ws.bufferedAmount > config.MAX_WS_MSG_BYTES * 4) {
          // Slow consumer — disconnect rather than accumulate backpressure
          ctx.ws.close(WS_CLOSE_POLICY_VIOLATION, "slow consumer");
          metrics.incrementCounter("ws_slow_consumer_disconnects");
          continue;
        }
        ctx.ws.send(data);
      }
      if (i < connIds.length) setImmediate(sendNext);
    };

    sendNext();
  }

  function ensureLocalRoom(roomId: string) {
    const existing = localRooms.get(roomId);
    if (existing) return existing;

    const now = Date.now();
    const exp = now + config.QR_ROTATION_MS;
    const token = mintJoinToken(config.JOIN_TOKEN_SECRET, roomId, exp);

    const r: LocalRoom = {
      roomId,
      conns: new Set(),
      qrToken: token,
      qrExpUnixMs: exp,
      qrTimer: setInterval(() => rotateQr(roomId), config.QR_ROTATION_MS).unref()
    };
    localRooms.set(roomId, r);
    return r;
  }

  function rotateQr(roomId: string) {
    const r = localRooms.get(roomId);
    if (!r) return;
    void roomStore.touch(roomId);
    const now = Date.now();
    const exp = now + config.QR_ROTATION_MS;
    const token = mintJoinToken(config.JOIN_TOKEN_SECRET, roomId, exp);
    r.qrToken = token;
    r.qrExpUnixMs = exp;
    broadcast(roomId, {
      v: 1, t: "QR_ROTATED", id: randomIdB64Url(12),
      body: { roomId, qrToken: token, qrExpUnixMs: exp }
    });
  }

  async function cleanupIfEmpty(roomId: string) {
    const r = localRooms.get(roomId);
    if (r && r.conns.size > 0) return;
    if (r) clearInterval(r.qrTimer);
    localRooms.delete(roomId);
  }

  async function leaveRoom(ctx: ConnCtx, roomId: string) {
    if (ctx.roomId !== roomId) return;
    ctx.roomId = undefined;
    const local = localRooms.get(roomId);
    local?.conns.delete(ctx.connId);
    const { remaining } = await roomStore.leave(roomId, ctx.connId);
    if (remaining <= 0) {
      await cleanupIfEmpty(roomId);
    } else {
      if (ctx.label) {
        broadcast(roomId, {
          v: 1, t: "SYSTEM_MSG", id: randomIdB64Url(12),
          body: { roomId, text: `${ctx.label} has left the chat`, type: "info" }
        });
      }
      broadcast(roomId, {
        v: 1, t: "ROOM_STATS", id: randomIdB64Url(12),
        body: { roomId, participants: remaining, max: config.ROOM_MAX_PARTICIPANTS }
      });
    }
  }

  async function onDisconnect(ctx: ConnCtx) {
    try {
      if (ctx.roomId) await leaveRoom(ctx, ctx.roomId);
    } finally {
      connections.delete(ctx.connId);
      ipLimiter.dec(ctx.ip);
      globalLimiter.dec();
      callbacks?.onDisconnect?.();
      metrics.incrementCounter("ws_disconnections");
    }
  }

  function parseClientMsg(raw: string): ClientMsg | null {
    const env = WsEnvelopeSchema.safeParse(JSON.parse(raw));
    if (!env.success) return null;
    const t = env.data.t;
    switch (t) {
      case "ROOM_CREATE": { const v = RoomCreateSchema.safeParse(env.data); return v.success ? v.data : null; }
      case "JOIN_REQUEST": { const v = JoinRequestSchema.safeParse(env.data); return v.success ? v.data : null; }
      case "LEAVE": { const v = LeaveSchema.safeParse(env.data); return v.success ? v.data : null; }
      case "APP_MSG": { const v = AppMsgSchema.safeParse(env.data); return v.success ? v.data : null; }
      case "MEDIA_MSG": { const v = MediaMsgSchema.safeParse(env.data); return v.success ? v.data : null; }
      case "PING": { const v = PingSchema.safeParse(env.data); return v.success ? v.data : null; }
      default: return null;
    }
  }

  // ── WebSocket route ──────────────────────────────────────────────────────────
  fastify.get("/ws", { websocket: true }, (socket: WebSocket, req) => {
    let disconnected = false;
    const ip = req.ip;

    // ── Connection admission ─────────────────────────────────────────────────
    if (!globalLimiter.tryInc()) {
      socket.close(WS_CLOSE_POLICY_VIOLATION, "server at capacity");
      metrics.incrementCounter("ws_connection_rejected", { reason: "global_limit" });
      return;
    }
    if (!ipLimiter.tryInc(ip)) {
      globalLimiter.dec();
      socket.close(WS_CLOSE_POLICY_VIOLATION, "too many connections from your IP");
      metrics.incrementCounter("ws_connection_rejected", { reason: "ip_limit" });
      return;
    }

    const connId = randomIdB64Url(12);
    const ctx: ConnCtx = {
      connId,
      ip,
      ws: socket,
      roomId: undefined,
      label: undefined,
      msgBucket: new TokenBucket({
        capacity: config.MAX_MSGS_PER_10S,
        refillTokens: config.MAX_MSGS_PER_10S,
        refillEveryMs: 10_000
      }),
      bytesBucket: new TokenBucket({
        capacity: config.MAX_BYTES_PER_10S,
        refillTokens: config.MAX_BYTES_PER_10S,
        refillEveryMs: 10_000
      }),
      lastPongMs: Date.now(),
      awaitingPong: false,
    };
    connections.set(connId, ctx);

    callbacks?.onConnect?.();
    metrics.incrementCounter("ws_connections_total");
    metrics.setGauge("ws_connections_active", connections.size);

    // Send HELLO
    wsSend(ctx, { v: 1, t: "HELLO", id: randomIdB64Url(12), body: { serverTimeUnixMs: Date.now() } });

    // ── Pong handler ─────────────────────────────────────────────────────────
    socket.on("pong", () => {
      ctx.lastPongMs = Date.now();
      ctx.awaitingPong = false;
    });

    // ── Message handler ──────────────────────────────────────────────────────
    socket.on("message", async (data: RawData) => {
      try {
        const raw = typeof data === "string" ? data : Buffer.from(data as any).toString("utf8");
        const bytes = Buffer.byteLength(raw, "utf8");

        // Size check first (cheapest)
        if (bytes > config.MAX_WS_MSG_BYTES) {
          socket.close(WS_CLOSE_POLICY_VIOLATION, "message too large");
          return;
        }

        // Rate limiting
        if (!ctx.msgBucket.take(1) || !ctx.bytesBucket.take(bytes)) {
          socket.close(WS_CLOSE_POLICY_VIOLATION, "rate limit exceeded");
          metrics.incrementCounter("ws_rate_limited");
          return;
        }

        let msg: ClientMsg | null = null;
        try { msg = parseClientMsg(raw); } catch { msg = null; }
        if (!msg) {
          socket.close(WS_CLOSE_UNSUPPORTED_DATA, "invalid message");
          return;
        }

        // Touch room TTL on any valid message from a room member
        if (ctx.roomId) void roomStore.touch(ctx.roomId);

        switch (msg.t) {
          case "PING": {
            wsSend(ctx, { v: 1, t: "PONG", id: randomIdB64Url(12), body: {} });
            return;
          }

          case "ROOM_CREATE": {
            if (ctx.roomId) {
              wsSend(ctx, { v: 1, t: "ERROR", id: randomIdB64Url(12), body: { code: "ERR_ALREADY_IN_ROOM", retryable: false } });
              return;
            }
            const roomId = randomIdB64Url(16);
            await roomStore.createRoom(roomId, ctx.connId);
            const local = ensureLocalRoom(roomId);
            local.conns.add(ctx.connId);
            ctx.roomId = roomId;
            wsSend(ctx, {
              v: 1, t: "ROOM_CREATED", id: randomIdB64Url(12),
              body: { roomId, qrToken: local.qrToken, qrExpUnixMs: local.qrExpUnixMs, maxParticipants: config.ROOM_MAX_PARTICIPANTS }
            });
            broadcast(roomId, { v: 1, t: "ROOM_STATS", id: randomIdB64Url(12), body: { roomId, participants: 1, max: config.ROOM_MAX_PARTICIPANTS } });
            metrics.incrementCounter("rooms_created");
            return;
          }

          case "JOIN_REQUEST": {
            if (ctx.roomId) {
              wsSend(ctx, { v: 1, t: "ERROR", id: randomIdB64Url(12), body: { code: "ERR_ALREADY_IN_ROOM", retryable: false } });
              return;
            }
            const { roomId, qrToken, token } = msg.body;
            const effectiveToken = qrToken || token;
            if (!effectiveToken) return;

            const tok = verifyJoinToken(config.JOIN_TOKEN_SECRET, effectiveToken);
            if (!tok.ok) {
              wsSend(ctx, { v: 1, t: "ERROR", id: randomIdB64Url(12), body: { code: tok.code, retryable: true } });
              return;
            }
            if (tok.payload.rid !== roomId) {
              wsSend(ctx, { v: 1, t: "ERROR", id: randomIdB64Url(12), body: { code: "ERR_TOKEN_ROOM_MISMATCH", retryable: false } });
              return;
            }
            const now = Date.now();
            if (now > tok.payload.exp) {
              wsSend(ctx, { v: 1, t: "ERROR", id: randomIdB64Url(12), body: { code: "ERR_TOKEN_EXPIRED", retryable: true } });
              return;
            }

            const graceMs = 5_000;
            const jtiTtlMs = Math.max(1, tok.payload.exp - now + graceMs);
            const fresh = await roomStore.markTokenJtiUsed(roomId, tok.payload.jti, jtiTtlMs);
            if (!fresh) {
              wsSend(ctx, { v: 1, t: "ERROR", id: randomIdB64Url(12), body: { code: "ERR_TOKEN_REPLAY", retryable: true } });
              return;
            }

            const joined = await roomStore.tryJoin(roomId, ctx.connId);
            if (!joined.ok) {
              wsSend(ctx, { v: 1, t: "ERROR", id: randomIdB64Url(12), body: { code: joined.code, retryable: joined.code !== "ERR_NO_ROOM" } });
              return;
            }

            const local = ensureLocalRoom(roomId);
            local.conns.add(ctx.connId);
            ctx.roomId = roomId;
            ctx.label = msg.body.label || joined.label;

            const nextToken = mintJoinToken(config.JOIN_TOKEN_SECRET, roomId, Date.now() + config.ROOM_KEY_TTL_MS);
            const nextTokenExpUnixMs = Date.now() + config.ROOM_KEY_TTL_MS;

            wsSend(ctx, {
              v: 1, t: "JOINED", id: randomIdB64Url(12),
              body: { roomId, participants: joined.count, max: config.ROOM_MAX_PARTICIPANTS, label: ctx.label, nextToken, nextTokenExpUnixMs }
            });

            broadcast(roomId, {
              v: 1, t: "SYSTEM_MSG", id: randomIdB64Url(12),
              body: { roomId, text: `this person has entered the chat with the name ${ctx.label}`, type: "info" }
            });

            broadcast(roomId, { v: 1, t: "ROOM_STATS", id: randomIdB64Url(12), body: { roomId, participants: joined.count, max: config.ROOM_MAX_PARTICIPANTS } });
            metrics.incrementCounter("rooms_joined");
            return;
          }

          case "LEAVE": {
            const { roomId } = msg.body;
            await leaveRoom(ctx, roomId);
            wsSend(ctx, { v: 1, t: "LEFT", id: randomIdB64Url(12), body: { roomId } });
            return;
          }

          case "APP_MSG": {
            const { roomId, ciphertextB64 } = msg.body;
            if (ctx.roomId !== roomId) {
              wsSend(ctx, { v: 1, t: "ERROR", id: randomIdB64Url(12), body: { code: "ERR_NOT_IN_ROOM", retryable: false } });
              return;
            }
            const ctBytes = Buffer.byteLength(ciphertextB64, "utf8");
            if (ctBytes > config.MAX_APP_CIPHERTEXT_BYTES) {
              wsSend(ctx, { v: 1, t: "ERROR", id: randomIdB64Url(12), body: { code: "ERR_CIPHERTEXT_TOO_LARGE", retryable: false } });
              return;
            }
            // Relay opaque ciphertext. Do not log. Do not parse.
            broadcast(roomId, { v: 1, t: "APP_MSG", id: randomIdB64Url(12), body: { roomId, ciphertextB64 } });
            metrics.incrementCounter("messages_relayed");
            return;
          }

          case "MEDIA_MSG": {
            // Encrypted image/file relay — server is a blind relay, never inspects content.
            const { roomId, mime, size, chunkSize, chunks } = msg.body;
            if (ctx.roomId !== roomId) {
              wsSend(ctx, { v: 1, t: "ERROR", id: randomIdB64Url(12), body: { code: "ERR_NOT_IN_ROOM", retryable: false } });
              return;
            }
            // Cap total serialized chunk data at 14 MB (base64 overhead ~33%)
            const totalChunkBytes = chunks.reduce((acc, c) => acc + Buffer.byteLength(c, "utf8"), 0);
            const MAX_RELAY_BYTES = 14 * 1024 * 1024;
            if (totalChunkBytes > MAX_RELAY_BYTES) {
              wsSend(ctx, { v: 1, t: "ERROR", id: randomIdB64Url(12), body: { code: "ERR_MEDIA_TOO_LARGE", retryable: false } });
              return;
            }
            // Relay opaque encrypted media to room. Do NOT log chunks.
            broadcast(roomId, { v: 1, t: "MEDIA_MSG", id: randomIdB64Url(12), body: { roomId, mime, size, chunkSize, chunks, from: msg.body.from } });
            metrics.incrementCounter("media_relayed");
            return;
          }
        }
      } catch (err) {
        fastify.log.error({ err }, "ws handler error");
        socket.close(1011, "internal error");
      }
    });

    socket.on("close", async () => {
      if (disconnected) return;
      disconnected = true;
      metrics.setGauge("ws_connections_active", connections.size - 1);
      await onDisconnect(ctx);
    });

    socket.on("error", async () => {
      if (disconnected) return;
      disconnected = true;
      await onDisconnect(ctx);
    });
  });
}
