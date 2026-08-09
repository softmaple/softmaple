import Redis from "ioredis";
import {
  LeaseAcquireResult,
  type ConnectionLeaseStore,
  type LeaseAcquireResult as LeaseAcquireResultType,
} from "./types";

const ACQUIRE_LEASE_LUA = `
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
if redis.call('ZSCORE', KEYS[1], ARGV[3]) then
  return -1
end
local count = redis.call('ZCARD', KEYS[1])
if count >= tonumber(ARGV[4]) then
  return 0
end
redis.call('ZADD', KEYS[1], ARGV[2], ARGV[3])
redis.call('PEXPIRE', KEYS[1], ARGV[5])
return 1
`;

const REFRESH_LEASE_LUA = `
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
if not redis.call('ZSCORE', KEYS[1], ARGV[3]) then
  return 0
end
redis.call('ZADD', KEYS[1], ARGV[2], ARGV[3])
redis.call('PEXPIRE', KEYS[1], ARGV[4])
return 1
`;

const keyForScope = (scope: string): string =>
  `softmaple:collab:lease:${scope}`;

export class RedisConnectionLeaseStore implements ConnectionLeaseStore {
  private readonly redis: Redis;
  private closed = false;

  constructor(redisUrl: string) {
    this.redis = new Redis(redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
      lazyConnect: false,
    });
  }

  async tryAcquire(
    scope: string,
    connectionId: string,
    maxConnections: number,
    ttlMs: number,
  ): Promise<LeaseAcquireResultType> {
    if (this.closed) throw new Error("Connection lease store is closed");
    const now = Date.now();
    const result = await this.redis.eval(
      ACQUIRE_LEASE_LUA,
      1,
      keyForScope(scope),
      String(now),
      String(now + ttlMs),
      connectionId,
      String(maxConnections),
      String(Math.max(ttlMs * 2, 60_000)),
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
    const now = Date.now();
    const result = await this.redis.eval(
      REFRESH_LEASE_LUA,
      1,
      keyForScope(scope),
      String(now),
      String(now + ttlMs),
      connectionId,
      String(Math.max(ttlMs * 2, 60_000)),
    );
    return result === 1;
  }

  async release(scope: string, connectionId: string): Promise<void> {
    if (this.closed) return;
    await this.redis.zrem(keyForScope(scope), connectionId);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.redis.quit().catch(() => undefined);
  }
}
