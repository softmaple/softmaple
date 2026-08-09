import Redis from "ioredis";

/** Bounds awaited Redis commands (leases/presence) during WebSocket setup. */
export const REDIS_COMMAND_TIMEOUT_MS = 5_000;

export const createRedisClient = (redisUrl: string): Redis =>
  new Redis(redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    lazyConnect: false,
    commandTimeout: REDIS_COMMAND_TIMEOUT_MS,
  });

/** Milliseconds from Redis TIME (seconds + microseconds). */
export const REDIS_TIME_MS_LUA = `
local t = redis.call('TIME')
return (tonumber(t[1]) * 1000) + math.floor(tonumber(t[2]) / 1000)
`;
