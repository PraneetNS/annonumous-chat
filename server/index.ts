import "dotenv/config";
import fs from "fs";
import path from "path";
import Fastify from "fastify";
import cors from "@fastify/cors";
import websocketPlugin from "@fastify/websocket";
import { createHmac, randomBytes } from "node:crypto";
import { RoomStore } from "./rooms.js";
import { registerWsRoutes } from "./ws.js";

function b64url(buf: Uint8Array): string {
  return Buffer.from(buf)
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

const HOST = process.env.HOST ?? "0.0.0.0";
const PORT = Number(process.env.PORT ?? "3001");

const TOKEN_TTL_MS = 60_000; // fixed requirement
const MAX_PARTICIPANTS = 50; // increased for multi-user mobile testing

const MAX_WS_MSG_BYTES = 256 * 1024;
const MAX_CIPHERTEXT_BYTES = 64 * 1024;
const MAX_MSGS_PER_10S = 200;
const MAX_BYTES_PER_10S = 1024 * 1024;

const rooms = new RoomStore({
  maxParticipants: MAX_PARTICIPANTS,
  tokenTtlMs: TOKEN_TTL_MS,
  redisUrl: process.env.REDIS_URL
});

const fastifyOpts: any = {
  logger: {
    level: process.env.LOG_LEVEL ?? "info",
    redact: {
      paths: ["req.body", "res.body", "req.headers.authorization", "req.headers.cookie"],
      remove: true
    }
  },
  trustProxy: true,
  bodyLimit: 64 * 1024
};

const certDir = path.join(process.cwd(), "server", "certs");
if (fs.existsSync(path.join(certDir, "key.pem")) && fs.existsSync(path.join(certDir, "cert.pem"))) {
  console.log("🔒 Enabling HTTPS/WSS with local certificates");
  fastifyOpts.https = {
    key: fs.readFileSync(path.join(certDir, "key.pem")),
    cert: fs.readFileSync(path.join(certDir, "cert.pem"))
  };
}

const fastify = Fastify(fastifyOpts);

await fastify.register(websocketPlugin, { options: { maxPayload: MAX_WS_MSG_BYTES } });

// Enable CORS for frontend
await fastify.register(cors, {
  origin: "*",
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true
});

fastify.get("/healthz", async () => ({ ok: true }));

/**
 * HTTP: Create a room and return a join token (for QR display).
 * No message persistence. No cookies. No user IDs.
 */
fastify.post("/rooms", async () => {
  const roomId = b64url(randomBytes(16));
  const tokenSecret = randomBytes(32); // per-room auth secret; not an encryption key
  await rooms.createRoom(roomId, tokenSecret);
  return { roomId, fingerprint: rooms.roomFingerprint(roomId) };
});

/**
 * HTTP: Get the current join token for a room.
 * Token rotates every 60s on the client (polling); token itself has exp inside and is validated server-side.
 *
 * Replay protection:
 * - Tokens are single-use (server remembers used token strings until expiry).
 */
fastify.get<{ Params: { roomId: string } }>("/rooms/:roomId/token", async (req, reply) => {
  const roomId = req.params.roomId;
  const tokenSecret = await rooms.getRoomSecret(roomId);
  if (!tokenSecret) return reply.code(404).send({ code: "ERR_NO_ROOM" });

  const expUnixMs = Date.now() + TOKEN_TTL_MS;
  const payload = Buffer.from(JSON.stringify({ v: 1, rid: roomId, exp: expUnixMs }), "utf8");
  const payloadB64 = b64url(payload);
  const mac = createHmac("sha256", tokenSecret).update(payload).digest();
  const token = `${payloadB64}.${b64url(mac)}`;
  return { roomId, token, expUnixMs };
});

registerWsRoutes(fastify as any, rooms, {
  maxWsMsgBytes: MAX_WS_MSG_BYTES,
  maxCiphertextBytes: MAX_CIPHERTEXT_BYTES,
  maxMsgsPer10s: MAX_MSGS_PER_10S,
  maxBytesPer10s: MAX_BYTES_PER_10S
});

// await fastify.listen({ host: HOST, port: PORT });
await fastify.listen({ host: "0.0.0.0", port: 3001 }); // Ensure it binds correctly

