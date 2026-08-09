import Redis from "ioredis";
import type { PresenceRoomStore } from "./types";

const usersKey = (roomId: string): string =>
  `softmaple:collab:presence:users:${roomId}`;
const expiryKey = (roomId: string): string =>
  `softmaple:collab:presence:expiry:${roomId}`;

const PURGE_EXPIRED_LUA = `
local expired = redis.call('ZRANGEBYSCORE', KEYS[2], '-inf', ARGV[1])
if #expired > 0 then
  redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', ARGV[1])
  redis.call('HDEL', KEYS[1], unpack(expired))
end
return expired
`;

const SET_USER_LUA = `
redis.call('HSET', KEYS[1], ARGV[1], ARGV[2])
redis.call('ZADD', KEYS[2], ARGV[3], ARGV[1])
redis.call('PEXPIRE', KEYS[1], ARGV[4])
redis.call('PEXPIRE', KEYS[2], ARGV[4])
return 1
`;

const REFRESH_USER_LUA = `
redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', ARGV[1])
if redis.call('HEXISTS', KEYS[1], ARGV[2]) == 0 then
  return 0
end
redis.call('ZADD', KEYS[2], ARGV[3], ARGV[2])
redis.call('PEXPIRE', KEYS[1], ARGV[4])
redis.call('PEXPIRE', KEYS[2], ARGV[4])
return 1
`;

export class RedisPresenceRoomStore implements PresenceRoomStore {
  private readonly redis: Redis;
  private closed = false;

  constructor(redisUrl: string) {
    this.redis = new Redis(redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
      lazyConnect: false,
    });
  }

  private async purgeExpired(roomId: string, now: number): Promise<string[]> {
    const expired = await this.redis.eval(
      PURGE_EXPIRED_LUA,
      2,
      usersKey(roomId),
      expiryKey(roomId),
      String(now),
    );
    if (!Array.isArray(expired)) return [];
    return expired.filter(
      (value): value is string => typeof value === "string",
    );
  }

  async setUser(roomId: string, user: unknown, ttlMs: number): Promise<void> {
    if (this.closed) throw new Error("Presence room store is closed");
    if (
      typeof user !== "object" ||
      user === null ||
      typeof (user as { connectionId?: unknown }).connectionId !== "string"
    ) {
      throw new Error("Presence user requires a connectionId");
    }
    const connectionId = (user as { connectionId: string }).connectionId;
    const now = Date.now();
    await this.purgeExpired(roomId, now);
    await this.redis.eval(
      SET_USER_LUA,
      2,
      usersKey(roomId),
      expiryKey(roomId),
      connectionId,
      JSON.stringify(user),
      String(now + ttlMs),
      String(Math.max(ttlMs * 2, 60_000)),
    );
  }

  async refresh(
    roomId: string,
    connectionId: string,
    ttlMs: number,
  ): Promise<boolean> {
    if (this.closed) throw new Error("Presence room store is closed");
    const now = Date.now();
    const result = await this.redis.eval(
      REFRESH_USER_LUA,
      2,
      usersKey(roomId),
      expiryKey(roomId),
      String(now),
      connectionId,
      String(now + ttlMs),
      String(Math.max(ttlMs * 2, 60_000)),
    );
    return result === 1;
  }

  async getUser(roomId: string, connectionId: string): Promise<unknown | null> {
    if (this.closed) throw new Error("Presence room store is closed");
    await this.purgeExpired(roomId, Date.now());
    const raw = await this.redis.hget(usersKey(roomId), connectionId);
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      return null;
    }
  }

  async listUsers(roomId: string): Promise<{
    readonly users: unknown[];
    readonly expiredConnectionIds: readonly string[];
  }> {
    if (this.closed) throw new Error("Presence room store is closed");
    const expiredConnectionIds = await this.purgeExpired(roomId, Date.now());
    const values = await this.redis.hvals(usersKey(roomId));
    const users: unknown[] = [];
    for (const raw of values) {
      try {
        users.push(JSON.parse(raw) as unknown);
      } catch {
        // Skip corrupt entries; durable document history is unaffected.
      }
    }
    return { users, expiredConnectionIds };
  }

  async removeUser(
    roomId: string,
    connectionId: string,
  ): Promise<unknown | null> {
    if (this.closed) return null;
    const raw = await this.redis.hget(usersKey(roomId), connectionId);
    await this.redis
      .multi()
      .hdel(usersKey(roomId), connectionId)
      .zrem(expiryKey(roomId), connectionId)
      .exec();
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      return null;
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.redis.quit().catch(() => undefined);
  }
}
