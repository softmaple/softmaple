import Redis from "ioredis";

export const createRedisClient = (redisUrl: string): Redis =>
  new Redis(redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    lazyConnect: false,
  });

/** Milliseconds from Redis TIME (seconds + microseconds). */
export const REDIS_TIME_MS_LUA = `
local t = redis.call('TIME')
return (tonumber(t[1]) * 1000) + math.floor(tonumber(t[2]) / 1000)
`;
