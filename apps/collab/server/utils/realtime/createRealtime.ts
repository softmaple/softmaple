import {
  CollabRealtimeDriver,
  resolveCollabRealtimeDriver,
  resolveRedisUrl,
} from "./env";
import { MemoryRealtimeBus } from "./memoryBus";
import { MemoryConnectionLeaseStore } from "./memory-leases";
import { MemoryPresenceRoomStore } from "./memoryPresence";
import { createRedisClient } from "./redisClient";
import { RedisRealtimeBus } from "./redisBus";
import { RedisConnectionLeaseStore } from "./redisLeases";
import { RedisPresenceRoomStore } from "./redisPresence";
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
  // One shared command connection (pub + leases + presence) plus one subscriber.
  const commandClient = createRedisClient(redisUrl);
  const subscriberClient = createRedisClient(redisUrl);
  const bus = new RedisRealtimeBus({
    publisher: commandClient,
    subscriber: subscriberClient,
    ownsSubscriber: true,
  });
  const leases = new RedisConnectionLeaseStore(commandClient);
  const presence = new RedisPresenceRoomStore(commandClient);
  return {
    bus,
    leases,
    presence,
    async close() {
      await Promise.all([bus.close(), leases.close(), presence.close()]);
      await commandClient.quit().catch(() => undefined);
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

export const closeRealtime = async (): Promise<void> => {
  if (realtimeSingleton === null) return;
  const current = realtimeSingleton;
  realtimeSingleton = null;
  await current.close();
};

export const setRealtimeForTests = async (
  realtime: CollabRealtime | null,
): Promise<void> => {
  if (realtimeSingleton !== null && realtimeSingleton !== realtime) {
    await realtimeSingleton.close().catch(() => undefined);
  }
  realtimeSingleton = realtime;
};
