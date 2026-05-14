import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PresenceEvent } from "../../types/events";
import { PRESENCE_EVENT } from "../../types/events";
import type { PresenceUser } from "../../types/presence";
import type { AdapterConnectionState, AdapterUserInfo } from "../types";
import { createNoopAdapter, noopAdapterFactory } from "./noop";

const userInfo: AdapterUserInfo = {
  userId: "user-1",
  name: "Ada",
  color: "#2563eb",
};

describe("createNoopAdapter", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("starts disconnected with no self and no presence", () => {
    const adapter = createNoopAdapter({ roomId: "doc-1", userInfo });

    expect(adapter.getConnectionState()).toBe("disconnected");
    expect(adapter.getSelf()).toBeNull();
    expect(adapter.getPresence().size).toBe(0);
  });

  it("transitions through connecting → connected on connect()", async () => {
    const adapter = createNoopAdapter({ roomId: "doc-1", userInfo });
    const states: AdapterConnectionState[] = [];
    adapter.onConnectionChange((state) => {
      states.push(state);
    });

    await adapter.connect();

    // First notification fires synchronously with the current ("disconnected")
    // state; then connecting and connected.
    expect(states).toEqual(["disconnected", "connecting", "connected"]);
    expect(adapter.getConnectionState()).toBe("connected");
    expect(adapter.getSelf()?.userId).toBe("user-1");
    expect(adapter.getPresence().size).toBe(1);
  });

  it("connect() is idempotent", async () => {
    const adapter = createNoopAdapter({ roomId: "doc-1", userInfo });
    await adapter.connect();
    const firstSelf = adapter.getSelf();
    await adapter.connect();
    expect(adapter.getSelf()).toBe(firstSelf);
    expect(adapter.getConnectionState()).toBe("connected");
  });

  it("disconnect() clears self and presence", async () => {
    const adapter = createNoopAdapter({ roomId: "doc-1", userInfo });
    await adapter.connect();
    await adapter.disconnect();

    expect(adapter.getConnectionState()).toBe("disconnected");
    expect(adapter.getSelf()).toBeNull();
    expect(adapter.getPresence().size).toBe(0);
  });

  it("disconnect() before connect is a no-op", async () => {
    const adapter = createNoopAdapter({ roomId: "doc-1", userInfo });
    await expect(adapter.disconnect()).resolves.toBeUndefined();
    expect(adapter.getConnectionState()).toBe("disconnected");
  });

  it("updatePresence mutates only the local self and notifies subscribers", async () => {
    const adapter = createNoopAdapter({ roomId: "doc-1", userInfo });
    await adapter.connect();

    const presenceSnapshots: ReadonlyMap<string, PresenceUser>[] = [];
    adapter.onPresenceChange((presence) => {
      presenceSnapshots.push(presence);
    });

    adapter.updatePresence({
      cursor: { blockId: "block-1", offset: 4 },
    });

    const self = adapter.getSelf();
    expect(self?.cursor).toEqual({ blockId: "block-1", offset: 4 });
    expect(adapter.getPresence().size).toBe(1);
    // Initial replay + one update.
    expect(presenceSnapshots.length).toBeGreaterThanOrEqual(2);
  });

  it("updatePresence before connect is a no-op", () => {
    const adapter = createNoopAdapter({ roomId: "doc-1", userInfo });
    adapter.updatePresence({ cursor: { blockId: "b", offset: 0 } });
    expect(adapter.getSelf()).toBeNull();
  });

  it("broadcast notifies event subscribers without touching the network", async () => {
    const adapter = createNoopAdapter({ roomId: "doc-1", userInfo });
    await adapter.connect();
    const events: PresenceEvent[] = [];
    adapter.onEvent((event) => {
      events.push(event);
    });

    adapter.broadcast({
      type: PRESENCE_EVENT.UPDATE,
      userId: "user-1",
      updates: { cursor: { blockId: "block-1", offset: 0 } },
    });

    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe(PRESENCE_EVENT.UPDATE);
  });

  it("onPresenceChange immediately replays current presence", async () => {
    const adapter = createNoopAdapter({ roomId: "doc-1", userInfo });
    await adapter.connect();

    const onPresence = vi.fn();
    adapter.onPresenceChange(onPresence);
    expect(onPresence).toHaveBeenCalledTimes(1);
    const replayed = onPresence.mock.calls[0]?.[0] as ReadonlyMap<
      string,
      PresenceUser
    >;
    expect(replayed.get("user-1")?.userId).toBe("user-1");
  });

  it("onConnectionChange immediately replays current state", async () => {
    const adapter = createNoopAdapter({ roomId: "doc-1", userInfo });
    await adapter.connect();

    const onConnection = vi.fn();
    adapter.onConnectionChange(onConnection);
    expect(onConnection).toHaveBeenLastCalledWith("connected");
  });

  it("never invokes the error subscriber on its own", async () => {
    const adapter = createNoopAdapter({ roomId: "doc-1", userInfo });
    const onError = vi.fn();
    adapter.onError(onError);

    await adapter.connect();
    adapter.updatePresence({ cursor: { blockId: "b", offset: 1 } });
    adapter.broadcast({
      type: PRESENCE_EVENT.SYNC,
      users: [],
    });
    await adapter.disconnect();

    expect(onError).not.toHaveBeenCalled();
  });

  it("returned presence map is a defensive copy", async () => {
    const adapter = createNoopAdapter({ roomId: "doc-1", userInfo });
    await adapter.connect();

    const snapshot = adapter.getPresence() as Map<string, PresenceUser>;
    snapshot.clear();

    expect(adapter.getPresence().size).toBe(1);
  });

  it("noopAdapterFactory delegates to createNoopAdapter", () => {
    const adapter = noopAdapterFactory({ roomId: "doc-1", userInfo });
    expect(typeof adapter.connect).toBe("function");
    expect(adapter.getConnectionState()).toBe("disconnected");
  });
});
