import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";
import {
  createDurableObjectPresenceFanout,
  createDurableObjectPresenceStore,
} from "../src/presence-capabilities";
import type { PresenceRoomDO } from "../src/presence-room-do";

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const MEMBER = {
  clock: 0,
  connectionId: "connection-1",
  userId: "user-1",
};

describe("Durable Object presence fanout", () => {
  it("isolates a rejected subscriber from the remaining handlers", async () => {
    const fanout = createDurableObjectPresenceFanout();
    const rejected = vi.fn(async () => {
      throw new Error("subscriber failed");
    });
    const delivered = vi.fn();
    await fanout.subscribe("room-1", rejected);
    await fanout.subscribe("room-1", delivered);

    const broadcast = { frame: { type: "join" }, roomId: "room-1" };
    await expect(fanout.publish(broadcast)).resolves.toBeUndefined();
    expect(rejected).toHaveBeenCalledWith(broadcast);
    expect(delivered).toHaveBeenCalledWith(broadcast);
  });

  it("does not deliver a broadcast to a different room's subscription", async () => {
    const fanout = createDurableObjectPresenceFanout();
    const otherRoom = vi.fn();
    await fanout.subscribe("room-2", otherRoom);
    await fanout.publish({ frame: {}, roomId: "room-1" });
    expect(otherRoom).not.toHaveBeenCalled();
  });
});

describe("Durable Object presence store (ctx.storage-backed, purge-on-read)", () => {
  it("round-trips a member and purges it once its TTL lapses", async () => {
    const stub = env.PRESENCE_ROOMS.getByName("store-test-1");
    await runInDurableObject(stub, async (_instance: PresenceRoomDO, state) => {
      const store = createDurableObjectPresenceStore(state.storage);
      await store.setMember("room-1", MEMBER, 25);
      await expect(store.getMember("room-1", "connection-1")).resolves.toEqual(
        MEMBER,
      );
      await sleep(40);
      await expect(
        store.getMember("room-1", "connection-1"),
      ).resolves.toBeNull();
    });
  });

  it("reports and purges an expired member through listMembers", async () => {
    const stub = env.PRESENCE_ROOMS.getByName("store-test-2");
    await runInDurableObject(stub, async (_instance: PresenceRoomDO, state) => {
      const store = createDurableObjectPresenceStore(state.storage);
      await store.setMember("room-1", MEMBER, 25);
      await sleep(40);
      const page = await store.listMembers("room-1");
      expect(page.members).toEqual([]);
      expect(page.expired).toEqual([
        { connectionId: "connection-1", userId: "user-1" },
      ]);
      // The expired entry was purged as a side effect of the read.
      const second = await store.listMembers("room-1");
      expect(second.expired).toEqual([]);
    });
  });

  it("refreshMember extends the TTL and returns false once lapsed", async () => {
    const stub = env.PRESENCE_ROOMS.getByName("store-test-3");
    await runInDurableObject(stub, async (_instance: PresenceRoomDO, state) => {
      const store = createDurableObjectPresenceStore(state.storage);
      await store.setMember("room-1", MEMBER, 25);
      await expect(
        store.refreshMember("room-1", "connection-1", 200),
      ).resolves.toBe(true);
      await sleep(40);
      // Refreshed above, so it should still be alive past the original TTL.
      await expect(store.getMember("room-1", "connection-1")).resolves.toEqual(
        MEMBER,
      );
      await expect(
        store.refreshMember("room-1", "unknown-connection", 200),
      ).resolves.toBe(false);
    });
  });

  it("removeMember returns the removed record only while it is still live", async () => {
    const stub = env.PRESENCE_ROOMS.getByName("store-test-4");
    await runInDurableObject(stub, async (_instance: PresenceRoomDO, state) => {
      const store = createDurableObjectPresenceStore(state.storage);
      await store.setMember("room-1", MEMBER, 25);
      await sleep(40);
      await expect(
        store.removeMember("room-1", "connection-1"),
      ).resolves.toBeNull();

      await store.setMember("room-1", MEMBER, 5_000);
      await expect(
        store.removeMember("room-1", "connection-1"),
      ).resolves.toEqual(MEMBER);
      await expect(
        store.getMember("room-1", "connection-1"),
      ).resolves.toBeNull();
    });
  });

  it("keeps members scoped to their own room id", async () => {
    const stub = env.PRESENCE_ROOMS.getByName("store-test-5");
    await runInDurableObject(stub, async (_instance: PresenceRoomDO, state) => {
      const store = createDurableObjectPresenceStore(state.storage);
      await store.setMember("room-a", MEMBER, 5_000);
      await expect(
        store.getMember("room-b", "connection-1"),
      ).resolves.toBeNull();
      const page = await store.listMembers("room-b");
      expect(page.members).toEqual([]);
    });
  });
});
