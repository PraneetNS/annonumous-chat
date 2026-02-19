import { z } from "zod";

// Envelope for all WS messages.
export const WsEnvelopeSchema = z.object({
  v: z.literal(1),
  t: z.string(),
  id: z.string().min(8).max(256),
  body: z.unknown()
});

export type WsEnvelope = z.infer<typeof WsEnvelopeSchema>;

export const RoomCreateSchema = z.object({
  v: z.literal(1),
  t: z.literal("ROOM_CREATE"),
  id: z.string(),
  body: z.object({})
});

export const JoinRequestSchema = z.object({
  v: z.literal(1),
  t: z.literal("JOIN_REQUEST"),
  id: z.string(),
  body: z.object({
    roomId: z.string().min(8).max(128),
    token: z.string().min(8).max(2048).optional(),
    qrToken: z.string().min(8).max(2048).optional(),
    label: z.string().min(1).max(32).optional()
  }).refine(data => data.token || data.qrToken, {
    message: "Either 'token' or 'qrToken' must be provided",
    path: ["token"]
  })
});

export const LeaveSchema = z.object({
  v: z.literal(1),
  t: z.literal("LEAVE"),
  id: z.string(),
  body: z.object({
    roomId: z.string().min(8).max(128)
  })
});

export const AppMsgSchema = z.object({
  v: z.literal(1),
  t: z.literal("APP_MSG"),
  id: z.string(),
  body: z.object({
    roomId: z.string().min(8).max(128),
    // The server must treat this as opaque ciphertext and never log it.
    ciphertextB64: z.string().min(1).max(200_000)
  })
});

// MEDIA_MSG: encrypted image/file sharing (chunked, server relays opaque ciphertext)
export const MediaMsgSchema = z.object({
  v: z.literal(1),
  t: z.literal("MEDIA_MSG"),
  id: z.string(),
  body: z.object({
    roomId: z.string().min(8).max(128),
    // Opaque encrypted media envelope — server never inspects payload.
    // mime + size are hints for the receiving client only.
    mime: z.string().max(128),
    size: z.coerce.number().int().min(1).max(10_485_760), // 10 MB max
    chunkSize: z.coerce.number().int().min(1024),
    // Each chunk is base64url(nonce || ciphertext); up to ~128 chunks of 256 KB
    chunks: z.array(z.string().min(1)).min(1).max(128)
  })
});

export const SystemMsgSchema = z.object({
  v: z.literal(1),
  t: z.literal("SYSTEM_MSG"),
  id: z.string(),
  body: z.object({
    roomId: z.string().min(8).max(128),
    text: z.string().max(1024),
    type: z.enum(["info", "warn", "error"]).default("info")
  })
});

export const PingSchema = z.object({
  v: z.literal(1),
  t: z.literal("PING"),
  id: z.string(),
  body: z.object({})
});

export type ClientMsg =
  | z.infer<typeof RoomCreateSchema>
  | z.infer<typeof JoinRequestSchema>
  | z.infer<typeof LeaveSchema>
  | z.infer<typeof AppMsgSchema>
  | z.infer<typeof MediaMsgSchema>
  | z.infer<typeof SystemMsgSchema>
  | z.infer<typeof PingSchema>;
