import { WS_MESSAGE } from "@softmaple/awareness/adapters/websocket";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createMemoryRealtime,
  LocalTopicHub,
  presenceRealtimeChannel,
  TopicBridge,
} from "../server/utils/realtime";

afterEach(() => {
  vi.useRealTimers();
});

describe("presence fan-out across instances", () => {
  it("delivers JOIN and UPDATE to peers on another instance", async () => {
    const shared = createMemoryRealtime();
    const hubA = new LocalTopicHub();
    const hubB = new LocalTopicHub();
    const bridgeA = new TopicBridge(shared.bus, hubA);
    const bridgeB = new TopicBridge(shared.bus, hubB);
    const roomId = "00000000-0000-4000-8000-000000000020";
    const channel = presenceRealtimeChannel(roomId);

    const peerA = { send: vi.fn() };
    const peerB = { send: vi.fn() };
    hubA.subscribe(channel, peerA);
    hubB.subscribe(channel, peerB);
    await bridgeA.retain(channel);
    await bridgeB.retain(channel);

    const joinMessage = {
      type: WS_MESSAGE.JOIN,
      roomId,
      senderId: "alice",
      timestamp: Date.now(),
      payload: {
        user: {
          connectionId: "alice",
          userId: "user-a",
          name: "Alice",
          color: "#111111",
          status: "active",
          clock: 0,
          lastActivityAt: 1,
          lastSeenAt: 1,
        },
      },
    };
    const joinedUser = joinMessage.payload.user;
    await shared.presence.setUser(roomId, joinedUser, 30_000);
    await shared.bus.publish(channel, joinMessage);

    expect(peerA.send).toHaveBeenCalledWith(joinMessage);
    expect(peerB.send).toHaveBeenCalledWith(joinMessage);

    const updateMessage = {
      type: WS_MESSAGE.PRESENCE_UPDATE,
      roomId,
      senderId: "alice",
      timestamp: Date.now(),
      payload: {
        connectionId: "alice",
        userId: "user-a",
        clock: 1,
        updates: {
          status: "active",
          lastActivityAt: 2,
          lastSeenAt: 2,
        },
      },
    };
    await shared.bus.publish(channel, updateMessage);
    expect(peerA.send).toHaveBeenCalledWith(updateMessage);
    expect(peerB.send).toHaveBeenCalledWith(updateMessage);

    const listed = await shared.presence.listUsers(roomId);
    expect(listed.users).toHaveLength(1);

    await bridgeA.close();
    await bridgeB.close();
    await shared.close();
  });

  it("expires presence after abrupt instance disappearance", async () => {
    const shared = createMemoryRealtime();
    const roomId = "00000000-0000-4000-8000-000000000021";
    const ghostUser = {
      connectionId: "ghost",
      userId: "user-g",
      name: "Ghost",
      color: "#333333",
      status: "active",
      clock: 0,
      lastActivityAt: 1,
      lastSeenAt: 1,
    };
    await shared.presence.setUser(roomId, ghostUser, 500);

    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 501);
    const listed = await shared.presence.listUsers(roomId);
    expect(listed.users).toEqual([]);
    expect(listed.expired).toContainEqual({
      connectionId: "ghost",
      userId: "user-g",
    });
    vi.useRealTimers();
    await shared.close();
  });
});
