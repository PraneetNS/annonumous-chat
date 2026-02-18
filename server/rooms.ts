import { createHash } from "node:crypto";
import { Redis } from "ioredis";

export type RoomId = string;
export type ConnId = string;

export type Participant = {
  connId: ConnId;
  label: string;
};

export type Room = {
  roomId: RoomId;
  createdAt: number;
  participants: Map<ConnId, Participant>;
  tokenSecret: Buffer;
  tokenExpMs: number;
};

export type RoomStoreConfig = {
  maxParticipants: number;
  tokenTtlMs: number;
  redisUrl?: string | undefined;
};

export class RoomStore {
  private readonly cfg: RoomStoreConfig;
  private readonly redis: Redis | null = null;
  private readonly memoryStore = new Map<RoomId, Room>();

  constructor(cfg: RoomStoreConfig) {
    this.cfg = cfg;
    if (cfg.redisUrl) {
      this.redis = new Redis(cfg.redisUrl);
      console.log("📡 RoomStore: Using Redis for room state.");
    } else {
      console.log("🧠 RoomStore: Using In-Memory storage.");
    }
  }

  async createRoom(roomId: RoomId, tokenSecret: Buffer): Promise<void> {
    if (this.redis) {
      const roomKey = `room:${roomId}`;
      await this.redis.hset(roomKey, {
        roomId,
        createdAt: Date.now().toString(),
        tokenSecret: tokenSecret.toString("base64"),
        tokenExpMs: this.cfg.tokenTtlMs.toString()
      });
      await this.redis.expire(roomKey, Math.ceil(this.cfg.tokenTtlMs / 1000) * 24); // Expire after a day
    } else {
      this.memoryStore.set(roomId, {
        roomId,
        createdAt: Date.now(),
        participants: new Map(),
        tokenSecret,
        tokenExpMs: this.cfg.tokenTtlMs
      });
    }
  }

  async getRoomSecret(roomId: RoomId): Promise<Buffer | undefined> {
    if (this.redis) {
      const secret = await this.redis.hget(`room:${roomId}`, "tokenSecret");
      return secret ? Buffer.from(secret, "base64") : undefined;
    }
    return this.memoryStore.get(roomId)?.tokenSecret;
  }

  async join(roomId: RoomId, connId: ConnId): Promise<{ ok: true; participant: Participant; count: number } | { ok: false; code: string }> {
    if (this.redis) {
      const roomKey = `room:${roomId}`;
      const exists = await this.redis.exists(roomKey);
      if (!exists) return { ok: false, code: "ERR_NO_ROOM" };

      const participantsKey = `room:${roomId}:participants`;
      const currentCount = await this.redis.hlen(participantsKey);

      if (currentCount >= this.cfg.maxParticipants) return { ok: false, code: "ERR_ROOM_FULL" };

      const label = `P${currentCount + 1}`;
      const participant = { connId, label };

      await this.redis.hset(participantsKey, connId, JSON.stringify(participant));
      return { ok: true, participant, count: currentCount + 1 };
    } else {
      const room = this.memoryStore.get(roomId);
      if (!room) return { ok: false, code: "ERR_NO_ROOM" };
      if (room.participants.size >= this.cfg.maxParticipants) return { ok: false, code: "ERR_ROOM_FULL" };
      const label = `P${room.participants.size + 1}`;
      const participant = { connId, label };
      room.participants.set(connId, participant);
      return { ok: true, participant, count: room.participants.size };
    }
  }

  async leave(roomId: RoomId, connId: ConnId): Promise<{ remaining: number }> {
    if (this.redis) {
      const participantsKey = `room:${roomId}:participants`;
      await this.redis.hdel(participantsKey, connId);
      const remaining = await this.redis.hlen(participantsKey);
      if (remaining === 0) {
        await this.redis.del(`room:${roomId}`);
        await this.redis.del(participantsKey);
      }
      return { remaining };
    } else {
      const room = this.memoryStore.get(roomId);
      if (!room) return { remaining: 0 };
      room.participants.delete(connId);
      const remaining = room.participants.size;
      if (remaining === 0) this.memoryStore.delete(roomId);
      return { remaining };
    }
  }

  async listParticipantConnIds(roomId: RoomId): Promise<ConnId[]> {
    if (this.redis) {
      return await this.redis.hkeys(`room:${roomId}:participants`);
    }
    return Array.from(this.memoryStore.get(roomId)?.participants.keys() || []);
  }

  roomFingerprint(roomId: RoomId): string {
    return createHash("sha256").update(roomId).digest("hex").slice(0, 12);
  }
}


