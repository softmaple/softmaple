import {
  CollabRealtimeDriver,
  resolveCollabRealtimeDriver,
  resolveRedisUrl,
} from "./env";
import { MemoryRealtimeBus } from "./memory-bus";
import { MemoryConnectionLeaseStore } from "./memory-leases";
import { MemoryPresenceRoomStore } from "./memory-presence";
import { RedisRealtimeBus } from "./redis-bus";
import { RedisConnectionLeaseStore } from "./redis-leases";
import { RedisPresenceRoomStore } from "./redis-presence";
import type { CollabRealtime } from "./types";

export const createMemoryRealtime = (): CollabRealtime => {
  const bus = new MemoryRealtimeBus();
  const leases = new MemoryConnectionLeaseStore();
  const presence = new MemoryPresenceRoomStore();
  return {
    bus,
    leases,
    presence,
    async close() {
      await Promise.all([bus.close(), leases.close(), presence.close()]);
    },
  };
};

export const createRedisRealtime = (redisUrl: string): CollabRealtime => {
  const bus = new RedisRealtimeBus(redisUrl);
  const leases = new RedisConnectionLeaseStore(redisUrl);
  const presence = new RedisPresenceRoomStore(redisUrl);
  return {
    bus,
    leases,
    presence,
    async close() {
      await Promise.all([bus.close(), leases.close(), presence.close()]);
    },
  };
};

export const createRealtimeFromEnv = (
  env: NodeJS.ProcessEnv = process.env,
): CollabRealtime => {
  const driver = resolveCollabRealtimeDriver(env);
  if (driver === CollabRealtimeDriver.Memory) {
    return createMemoryRealtime();
  }
  return createRedisRealtime(resolveRedisUrl(env));
};

let realtimeSingleton: CollabRealtime | null = null;

export const getRealtime = (): CollabRealtime => {
  if (realtimeSingleton === null) {
    realtimeSingleton = createRealtimeFromEnv();
  }
  return realtimeSingleton;
};

export const setRealtimeForTests = (realtime: CollabRealtime | null): void => {
  realtimeSingleton = realtime;
};
