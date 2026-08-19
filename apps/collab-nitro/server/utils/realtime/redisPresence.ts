import type Redis from "ioredis";
import {
  presenceUserIdFromUnknown,
  requirePresenceConnectionId,
} from "./presenceUser";
import type {
  ExpiredPresenceMember,
  PresenceRoomStore,
  PresenceUserRecord,
} from "./types";

const usersKey = (roomId: string): string =>
  `softmaple:collab:presence:users:${roomId}`;
const expiryKey = (roomId: string): string =>
  `softmaple:collab:presence:expiry:${roomId}`;

const PURGE_EXPIRED_LUA = `
local t = redis.call('TIME')
local now = (tonumber(t[1]) * 1000) + math.floor(tonumber(t[2]) / 1000)
local expiredIds = redis.call('ZRANGEBYSCORE', KEYS[2], '-inf', now)
local result = {}
if #expiredIds > 0 then
  for _, id in ipairs(expiredIds) do
    local raw = redis.call('HGET', KEYS[1], id)
    result[#result + 1] = id
    result[#result + 1] = raw or ''
  end
  redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', now)
  redis.call('HDEL', KEYS[1], unpack(expiredIds))
end
return result
`;

const SET_USER_LUA = `
local t = redis.call('TIME')
local now = (tonumber(t[1]) * 1000) + math.floor(tonumber(t[2]) / 1000)
local ttl = tonumber(ARGV[3])
local expiry = now + ttl
local keyTtl = math.max(ttl * 2, 60000)
redis.call('HSET', KEYS[1], ARGV[1], ARGV[2])
redis.call('ZADD', KEYS[2], expiry, ARGV[1])
redis.call('PEXPIRE', KEYS[1], keyTtl)
redis.call('PEXPIRE', KEYS[2], keyTtl)
return 1
`;

const REFRESH_USER_LUA = `
local t = redis.call('TIME')
local now = (tonumber(t[1]) * 1000) + math.floor(tonumber(t[2]) / 1000)
local ttl = tonumber(ARGV[2])
local expiry = now + ttl
local keyTtl = math.max(ttl * 2, 60000)
redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', now)
if redis.call('HEXISTS', KEYS[1], ARGV[1]) == 0 then
  return 0
end
redis.call('ZADD', KEYS[2], expiry, ARGV[1])
redis.call('PEXPIRE', KEYS[1], keyTtl)
redis.call('PEXPIRE', KEYS[2], keyTtl)
return 1
`;

interface PresenceRedis extends Redis {
  collabPurgeExpiredPresence(
    usersKey: string,
    expiryKey: string,
  ): Promise<unknown>;
  collabSetPresenceUser(
    usersKey: string,
    expiryKey: string,
    connectionId: string,
    userJson: string,
    ttlMs: string,
  ): Promise<number>;
  collabRefreshPresenceUser(
    usersKey: string,
    expiryKey: string,
    connectionId: string,
    ttlMs: string,
  ): Promise<number>;
}

const definePresenceCommands = (redis: Redis): PresenceRedis => {
  const client = redis as PresenceRedis;
  if (typeof client.collabPurgeExpiredPresence !== "function") {
    client.defineCommand("collabPurgeExpiredPresence", {
      numberOfKeys: 2,
      lua: PURGE_EXPIRED_LUA,
    });
  }
  if (typeof client.collabSetPresenceUser !== "function") {
    client.defineCommand("collabSetPresenceUser", {
      numberOfKeys: 2,
      lua: SET_USER_LUA,
    });
  }
  if (typeof client.collabRefreshPresenceUser !== "function") {
    client.defineCommand("collabRefreshPresenceUser", {
      numberOfKeys: 2,
      lua: REFRESH_USER_LUA,
    });
  }
  return client;
};

const parseExpiredMembers = (raw: unknown): ExpiredPresenceMember[] => {
  if (!Array.isArray(raw)) return [];
  const expired: ExpiredPresenceMember[] = [];
  for (let index = 0; index + 1 < raw.length; index += 2) {
    const connectionId = raw[index];
    const userJson = raw[index + 1];
    if (typeof connectionId !== "string" || connectionId.length === 0) continue;
    let userId = "unknown";
    if (typeof userJson === "string" && userJson.length > 0) {
      try {
        userId = presenceUserIdFromUnknown(JSON.parse(userJson) as unknown);
      } catch {
        userId = "unknown";
      }
    }
    expired.push({ connectionId, userId });
  }
  return expired;
};

export class RedisPresenceRoomStore implements PresenceRoomStore {
  private readonly redis: PresenceRedis;
  private closed = false;

  constructor(redis: Redis) {
    this.redis = definePresenceCommands(redis);
  }

  private async purgeExpired(roomId: string): Promise<ExpiredPresenceMember[]> {
    const raw = await this.redis.collabPurgeExpiredPresence(
      usersKey(roomId),
      expiryKey(roomId),
    );
    return parseExpiredMembers(raw);
  }

  async setUser(
    roomId: string,
    user: PresenceUserRecord,
    ttlMs: number,
  ): Promise<void> {
    if (this.closed) throw new Error("Presence room store is closed");
    const connectionId = requirePresenceConnectionId(user);
    await this.purgeExpired(roomId);
    await this.redis.collabSetPresenceUser(
      usersKey(roomId),
      expiryKey(roomId),
      connectionId,
      JSON.stringify(user),
      String(ttlMs),
    );
  }

  async refresh(
    roomId: string,
    connectionId: string,
    ttlMs: number,
  ): Promise<boolean> {
    if (this.closed) throw new Error("Presence room store is closed");
    const result = await this.redis.collabRefreshPresenceUser(
      usersKey(roomId),
      expiryKey(roomId),
      connectionId,
      String(ttlMs),
    );
    return result === 1;
  }

  async getUser(roomId: string, connectionId: string): Promise<unknown | null> {
    if (this.closed) throw new Error("Presence room store is closed");
    await this.purgeExpired(roomId);
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
    readonly expired: ReadonlyArray<ExpiredPresenceMember>;
  }> {
    if (this.closed) throw new Error("Presence room store is closed");
    const expired = await this.purgeExpired(roomId);
    const values = await this.redis.hvals(usersKey(roomId));
    const users: unknown[] = [];
    for (const raw of values) {
      try {
        users.push(JSON.parse(raw) as unknown);
      } catch {
        // Skip corrupt entries; durable document history is unaffected.
      }
    }
    return { users, expired };
  }

  async removeUser(roomId: string, connectionId: string): Promise<unknown> {
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
    // Shared command client is closed by createRedisRealtime / closeRealtime.
    this.closed = true;
  }
}
