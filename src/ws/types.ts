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
    qrToken: z.string().min(8).max(2048).optional()
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
  | z.infer<typeof PingSchema>;

