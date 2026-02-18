import type Redis from "ioredis";
import { createHash } from "node:crypto";

export type RoomCreateResult = {
  roomId: string;
  participantCount: number;
};

/**
 * Redis-backed room tracking.
 *
 * IMPORTANT:
 * - This stores only room membership/count and TTL. No messages are stored.
 * - Keys always have TTL (PEXPIRE), so orphaned data auto-cleans up.
 */
export class RoomStore {
  private readonly redis: Redis;
  private readonly ttlMs: number;
  private readonly maxParticipants: number;

  constructor(opts: { redis: Redis; ttlMs: number; maxParticipants: number }) {
    this.redis = opts.redis;
    this.ttlMs = opts.ttlMs;
    this.maxParticipants = opts.maxParticipants;
  }

  private kMeta(roomId: string) {
    return `room:${roomId}:meta`;
  }
  private kMembers(roomId: string) {
    return `room:${roomId}:members`;
  }
  private kCount(roomId: string) {
    return `room:${roomId}:count`;
  }
  private kJtis(roomId: string) {
    return `room:${roomId}:jtis`;
  }

  async createRoom(roomId: string, creatorConnId: string): Promise<RoomCreateResult> {
    const metaKey = this.kMeta(roomId);
    const memKey = this.kMembers(roomId);
    const countKey = this.kCount(roomId);
    const jtisKey = this.kJtis(roomId);

    const now = Date.now();
    // Use MULTI to keep consistency.
    const res = await this.redis
      .multi()
      .hset(metaKey, { createdAt: String(now) })
      .sadd(memKey, creatorConnId)
      .set(countKey, "1")
      .del(jtisKey)
      .pexpire(metaKey, this.ttlMs)
      .pexpire(memKey, this.ttlMs)
      .pexpire(countKey, this.ttlMs)
      .pexpire(jtisKey, this.ttlMs)
      .exec();

    if (!res) throw new Error("redis transaction failed");
    return { roomId, participantCount: 1 };
  }

  async createRoomEmpty(roomId: string): Promise<void> {
    const metaKey = this.kMeta(roomId);
    const countKey = this.kCount(roomId);
    const now = Date.now();
    await this.redis
      .multi()
      .hset(metaKey, { createdAt: String(now) })
      .set(countKey, "0")
      .pexpire(metaKey, this.ttlMs)
      .pexpire(countKey, this.ttlMs)
      .exec();
  }

  /**
   * Atomically attempts to add a member.
   * Returns:
   * - ok=false with code if room missing, full, or already a member
   * - ok=true with updated count if added
   */
  async tryJoin(roomId: string, connId: string): Promise<{ ok: true; count: number; label: string } | { ok: false; code: string }> {
    const metaKey = this.kMeta(roomId);
    const memKey = this.kMembers(roomId);
    const countKey = this.kCount(roomId);

    // Lua script ensures:
    // - room exists (metaKey)
    // - no over-capacity
    // - add only once per connId
    // - refresh TTLs on activity
    const script = `
      local metaKey = KEYS[1]
      local memKey = KEYS[2]
      local countKey = KEYS[3]
      local connId = ARGV[1]
      local max = tonumber(ARGV[2])
      local ttlMs = tonumber(ARGV[3])

      if redis.call("EXISTS", metaKey) == 0 then
        return {0, "ERR_NO_ROOM"}
      end

      local cur = tonumber(redis.call("GET", countKey) or "0")
      if redis.call("SISMEMBER", memKey, connId) == 1 then
        redis.call("PEXPIRE", metaKey, ttlMs)
        redis.call("PEXPIRE", memKey, ttlMs)
        redis.call("PEXPIRE", countKey, ttlMs)
        -- We don't easily know their original label if we don't store it, 
        -- but for this simple version we can re-derive it or just return count.
        -- Let's just return what we have.
        return {1, cur, "P" .. cur} 
      end

      if cur >= max then
        return {0, "ERR_ROOM_FULL", cur}
      end

      redis.call("SADD", memKey, connId)
      cur = cur + 1
      redis.call("SET", countKey, tostring(cur))

      redis.call("PEXPIRE", metaKey, ttlMs)
      redis.call("PEXPIRE", memKey, ttlMs)
      redis.call("PEXPIRE", countKey, ttlMs)

      return {1, cur, "P" .. cur}
    `;

    const out = (await this.redis.eval(script, 3, metaKey, memKey, countKey, connId, String(this.maxParticipants), String(this.ttlMs))) as unknown;
    if (!Array.isArray(out)) throw new Error("unexpected redis eval result");

    const ok = out[0];
    if (ok === 1) return { ok: true, count: Number(out[1]), label: String(out[2]) };
    return { ok: false, code: String(out[1] ?? "ERR_JOIN_FAILED") };
  }

  async leave(roomId: string, connId: string): Promise<{ remaining: number }> {
    const metaKey = this.kMeta(roomId);
    const memKey = this.kMembers(roomId);
    const countKey = this.kCount(roomId);
    const jtisKey = this.kJtis(roomId);

    const script = `
      local metaKey = KEYS[1]
      local memKey = KEYS[2]
      local countKey = KEYS[3]
      local jtisKey = KEYS[4]
      local connId = ARGV[1]
      local ttlMs = tonumber(ARGV[2])
      local roomId = ARGV[3]

      if redis.call("EXISTS", metaKey) == 0 then
        return 0
      end

      local removed = redis.call("SREM", memKey, connId)
      local cur = tonumber(redis.call("GET", countKey) or "0")
      if removed == 1 and cur > 0 then
        cur = cur - 1
        redis.call("SET", countKey, tostring(cur))
      end

      if cur <= 0 then
        local jtis = redis.call("SMEMBERS", jtisKey)
        for i = 1, #jtis do
          redis.call("DEL", "room:" .. roomId .. ":jti:" .. jtis[i])
        end
        redis.call("DEL", metaKey)
        redis.call("DEL", memKey)
        redis.call("DEL", countKey)
        redis.call("DEL", jtisKey)
        return 0
      end

      redis.call("PEXPIRE", metaKey, ttlMs)
      redis.call("PEXPIRE", memKey, ttlMs)
      redis.call("PEXPIRE", countKey, ttlMs)
      redis.call("PEXPIRE", jtisKey, ttlMs)
      return cur
    `;

    const remaining = (await this.redis.eval(script, 4, metaKey, memKey, countKey, jtisKey, connId, String(this.ttlMs), roomId)) as unknown;
    return { remaining: Number(remaining) };
  }

  async roomExists(roomId: string): Promise<boolean> {
    return (await this.redis.exists(this.kMeta(roomId))) === 1;
  }

  async touch(roomId: string): Promise<void> {
    const metaKey = this.kMeta(roomId);
    const memKey = this.kMembers(roomId);
    const countKey = this.kCount(roomId);
    const jtisKey = this.kJtis(roomId);
    await this.redis
      .multi()
      .pexpire(metaKey, this.ttlMs)
      .pexpire(memKey, this.ttlMs)
      .pexpire(countKey, this.ttlMs)
      .pexpire(jtisKey, this.ttlMs)
      .exec();
  }

  async markTokenJtiUsed(roomId: string, jti: string, ttlMs: number): Promise<boolean> {
    // NX+PX ensures replay resistance. Value irrelevant.
    const key = `room:${roomId}:jti:${jti}`;
    const jtisKey = this.kJtis(roomId);
    const res = await this.redis.set(key, "1", "PX", ttlMs, "NX");
    if (res !== "OK") return false;
    // Track jtis so we can delete them on room close (strict cleanup).
    await this.redis
      .multi()
      .sadd(jtisKey, jti)
      .pexpire(jtisKey, this.ttlMs)
      .exec();
    return true;
  }

  roomFingerprint(roomId: string): string {
    return createHash("sha256").update(roomId).digest("hex").slice(0, 12);
  }
}

