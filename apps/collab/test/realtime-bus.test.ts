import { COLLAB_PROTOCOL_VERSION } from "@softmaple/collab-protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CollabRealtimeConfigError,
  createMemoryRealtime,
  documentLeaseScope,
  documentRealtimeChannel,
  LeaseAcquireResult,
  LocalTopicHub,
  resolveCollabRealtimeDriver,
  resolveRedisUrl,
  TopicBridge,
} from "../server/utils/realtime";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("memory realtime bus", () => {
  it("delivers publish payloads to every subscriber", async () => {
    const realtime = createMemoryRealtime();
    const seenA: unknown[] = [];
    const seenB: unknown[] = [];
    const unsubscribeA = await realtime.bus.subscribe(
      "channel-a",
      (payload) => {
        seenA.push(payload);
      },
    );
    const unsubscribeB = await realtime.bus.subscribe(
      "channel-a",
      (payload) => {
        seenB.push(payload);
      },
    );

    await realtime.bus.publish("channel-a", { hello: "world" });
    expect(seenA).toEqual([{ hello: "world" }]);
    expect(seenB).toEqual([{ hello: "world" }]);

    await unsubscribeA();
    await realtime.bus.publish("channel-a", { hello: "again" });
    expect(seenA).toEqual([{ hello: "world" }]);
    expect(seenB).toEqual([{ hello: "world" }, { hello: "again" }]);

    await unsubscribeB();
    await realtime.close();
  });

  it("fans out across two simulated collab instances", async () => {
    const shared = createMemoryRealtime();
    const hubA = new LocalTopicHub();
    const hubB = new LocalTopicHub();
    const bridgeA = new TopicBridge(shared.bus, hubA);
    const bridgeB = new TopicBridge(shared.bus, hubB);
    const channel = documentRealtimeChannel(
      "00000000-0000-4000-8000-000000000001",
      COLLAB_PROTOCOL_VERSION,
    );

    const peerA = { send: vi.fn() };
    const peerB = { send: vi.fn() };
    hubA.subscribe(channel, peerA);
    hubB.subscribe(channel, peerB);
    await bridgeA.retain(channel);
    await bridgeB.retain(channel);

    const payload = {
      protocolVersion: COLLAB_PROTOCOL_VERSION,
      type: "event",
      batches: [{ batchId: "b1" }],
    };
    await shared.bus.publish(channel, payload);

    expect(peerA.send).toHaveBeenCalledWith(payload);
    expect(peerB.send).toHaveBeenCalledWith(payload);

    // Duplicate realtime delivery remains tolerable.
    await shared.bus.publish(channel, payload);
    expect(peerA.send).toHaveBeenCalledTimes(2);
    expect(peerB.send).toHaveBeenCalledTimes(2);

    await bridgeA.release(channel);
    await bridgeB.release(channel);
    await shared.close();
  });

  it("cleans up bus subscriptions when the last local peer leaves", async () => {
    const shared = createMemoryRealtime();
    const hub = new LocalTopicHub();
    const bridge = new TopicBridge(shared.bus, hub);
    const channel = documentRealtimeChannel(
      "00000000-0000-4000-8000-000000000099",
      COLLAB_PROTOCOL_VERSION,
    );
    let activeHandlers = 0;
    const originalSubscribe = shared.bus.subscribe.bind(shared.bus);
    vi.spyOn(shared.bus, "subscribe").mockImplementation(
      async (subscribedChannel, handler) => {
        activeHandlers += 1;
        const unsubscribe = await originalSubscribe(subscribedChannel, handler);
        return async () => {
          activeHandlers -= 1;
          await unsubscribe();
        };
      },
    );

    await bridge.retain(channel);
    await bridge.retain(channel);
    expect(activeHandlers).toBe(1);

    await bridge.release(channel);
    expect(activeHandlers).toBe(1);
    await bridge.release(channel);
    expect(activeHandlers).toBe(0);
    await shared.close();
  });
});

describe("connection leases", () => {
  it("enforces a distributed connection limit across instances", async () => {
    const shared = createMemoryRealtime();
    const scope = documentLeaseScope("doc-1");

    for (let index = 0; index < 100; index += 1) {
      const result = await shared.leases.tryAcquire(
        scope,
        `conn-${index}`,
        100,
        1_000,
      );
      expect(result).toBe(LeaseAcquireResult.Acquired);
    }

    expect(
      await shared.leases.tryAcquire(scope, "conn-overflow", 100, 1_000),
    ).toBe(LeaseAcquireResult.Full);

    // Abrupt disappearance: TTL expiry recovers the slot without close().
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 1_001);
    expect(
      await shared.leases.tryAcquire(scope, "conn-recovered", 100, 1_000),
    ).toBe(LeaseAcquireResult.Acquired);
    vi.useRealTimers();

    await shared.close();
  });

  it("rejects duplicate connection ids", async () => {
    const shared = createMemoryRealtime();
    const scope = documentLeaseScope("doc-2");
    expect(await shared.leases.tryAcquire(scope, "same", 10, 5_000)).toBe(
      LeaseAcquireResult.Acquired,
    );
    expect(await shared.leases.tryAcquire(scope, "same", 10, 5_000)).toBe(
      LeaseAcquireResult.Duplicate,
    );
    await shared.leases.release(scope, "same");
    expect(await shared.leases.tryAcquire(scope, "same", 10, 5_000)).toBe(
      LeaseAcquireResult.Acquired,
    );
    await shared.close();
  });
});

describe("presence room store", () => {
  it("shares presence state across instances and expires stale members", async () => {
    const shared = createMemoryRealtime();
    const roomId = "00000000-0000-4000-8000-000000000010";
    const alice = {
      connectionId: "alice",
      userId: "user-a",
      name: "Alice",
      color: "#111111",
      status: "active",
      clock: 0,
      lastActivityAt: 1,
      lastSeenAt: 1,
    };
    const bob = {
      connectionId: "bob",
      userId: "user-b",
      name: "Bob",
      color: "#222222",
      status: "active",
      clock: 0,
      lastActivityAt: 1,
      lastSeenAt: 1,
    };
    await shared.presence.setUser(roomId, alice, 1_000);
    await shared.presence.setUser(roomId, bob, 1_000);

    const listed = await shared.presence.listUsers(roomId);
    expect(listed.users).toHaveLength(2);
    expect(listed.expired).toEqual([]);

    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 1_001);
    const expired = await shared.presence.listUsers(roomId);
    expect(expired.users).toEqual([]);
    expect(expired.expired).toEqual(
      expect.arrayContaining([
        { connectionId: "alice", userId: "user-a" },
        { connectionId: "bob", userId: "user-b" },
      ]),
    );
    vi.useRealTimers();
    await shared.close();
  });
});

describe("realtime environment validation", () => {
  it("defaults to memory locally and redis on Vercel preview/production", () => {
    expect(resolveCollabRealtimeDriver({})).toBe("memory");
    // Vercel CLI local runs set VERCEL=1 with VERCEL_ENV=development.
    expect(resolveCollabRealtimeDriver({ VERCEL: "1" })).toBe("memory");
    expect(
      resolveCollabRealtimeDriver({
        VERCEL: "1",
        VERCEL_ENV: "development",
      }),
    ).toBe("memory");
    expect(resolveCollabRealtimeDriver({ VERCEL_ENV: "preview" })).toBe(
      "redis",
    );
    expect(resolveCollabRealtimeDriver({ VERCEL_ENV: "production" })).toBe(
      "redis",
    );
  });

  it("fails fast when production Redis URL is missing", () => {
    expect(() =>
      resolveRedisUrl({ COLLAB_REALTIME_DRIVER: "redis" }),
    ).toThrowError(CollabRealtimeConfigError);
  });

  it("rejects memory driver on Vercel preview/production", () => {
    expect(() =>
      resolveCollabRealtimeDriver({
        VERCEL_ENV: "production",
        COLLAB_REALTIME_DRIVER: "memory",
      }),
    ).toThrowError(CollabRealtimeConfigError);
  });

  it("accepts redis and rediss URLs", () => {
    expect(resolveRedisUrl({ REDIS_URL: "redis://localhost:6379" })).toBe(
      "redis://localhost:6379",
    );
    expect(
      resolveRedisUrl({ REDIS_URL: "rediss://default:secret@upstash:6379" }),
    ).toBe("rediss://default:secret@upstash:6379");
  });
});
