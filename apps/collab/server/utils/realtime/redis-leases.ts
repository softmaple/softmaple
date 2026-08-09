import type Redis from "ioredis";
import {
  LeaseAcquireResult,
  type ConnectionLeaseStore,
  type LeaseAcquireResult as LeaseAcquireResultType,
} from "./types";

const ACQUIRE_LEASE_LUA = `
local t = redis.call('TIME')
local now = (tonumber(t[1]) * 1000) + math.floor(tonumber(t[2]) / 1000)
local ttl = tonumber(ARGV[2])
local expiry = now + ttl
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now)
if redis.call('ZSCORE', KEYS[1], ARGV[1]) then
  return -1
end
local count = redis.call('ZCARD', KEYS[1])
if count >= tonumber(ARGV[3]) then
  return 0
end
redis.call('ZADD', KEYS[1], expiry, ARGV[1])
redis.call('PEXPIRE', KEYS[1], math.max(ttl * 2, 60000))
return 1
`;

const REFRESH_LEASE_LUA = `
local t = redis.call('TIME')
local now = (tonumber(t[1]) * 1000) + math.floor(tonumber(t[2]) / 1000)
local ttl = tonumber(ARGV[2])
local expiry = now + ttl
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now)
if not redis.call('ZSCORE', KEYS[1], ARGV[1]) then
  return 0
end
redis.call('ZADD', KEYS[1], expiry, ARGV[1])
redis.call('PEXPIRE', KEYS[1], math.max(ttl * 2, 60000))
return 1
`;

const keyForScope = (scope: string): string =>
  `softmaple:collab:lease:${scope}`;

interface LeaseRedis extends Redis {
  collabAcquireLease(
    key: string,
    connectionId: string,
    ttlMs: string,
    maxConnections: string,
  ): Promise<number>;
  collabRefreshLease(
    key: string,
    connectionId: string,
    ttlMs: string,
  ): Promise<number>;
}

const defineLeaseCommands = (redis: Redis): LeaseRedis => {
  const client = redis as LeaseRedis;
  if (typeof client.collabAcquireLease !== "function") {
    client.defineCommand("collabAcquireLease", {
      numberOfKeys: 1,
      lua: ACQUIRE_LEASE_LUA,
    });
  }
  if (typeof client.collabRefreshLease !== "function") {
    client.defineCommand("collabRefreshLease", {
      numberOfKeys: 1,
      lua: REFRESH_LEASE_LUA,
    });
  }
  return client;
};

export class RedisConnectionLeaseStore implements ConnectionLeaseStore {
  private readonly redis: LeaseRedis;
  private closed = false;

  constructor(redis: Redis) {
    this.redis = defineLeaseCommands(redis);
  }

  async tryAcquire(
    scope: string,
    connectionId: string,
    maxConnections: number,
    ttlMs: number,
  ): Promise<LeaseAcquireResultType> {
    if (this.closed) throw new Error("Connection lease store is closed");
    const result = await this.redis.collabAcquireLease(
      keyForScope(scope),
      connectionId,
      String(ttlMs),
      String(maxConnections),
    );
    if (result === 1) return LeaseAcquireResult.Acquired;
    if (result === -1) return LeaseAcquireResult.Duplicate;
    return LeaseAcquireResult.Full;
  }

  async refresh(
    scope: string,
    connectionId: string,
    ttlMs: number,
  ): Promise<boolean> {
    if (this.closed) throw new Error("Connection lease store is closed");
    const result = await this.redis.collabRefreshLease(
      keyForScope(scope),
      connectionId,
      String(ttlMs),
    );
    return result === 1;
  }

  async release(scope: string, connectionId: string): Promise<void> {
    if (this.closed) return;
    await this.redis.zrem(keyForScope(scope), connectionId);
  }

  async close(): Promise<void> {
    // Shared command client is closed by createRedisRealtime / closeRealtime.
    this.closed = true;
  }
}
