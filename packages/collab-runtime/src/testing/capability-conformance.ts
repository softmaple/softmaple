import type {
  ConnectionLimiter,
  ConnectionPolicy,
} from "../connection-limiter";
import type { PresenceFanout } from "../presence-fanout";
import type { PresenceMemberRecord, PresenceStore } from "../presence-store";
import { check, checkEqual, type ConformanceCase } from "./conformance-case";

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const TEST_TTL_MS = 15;
const TEST_TTL_MARGIN_MS = 60;

const testMember = (
  overrides: Partial<PresenceMemberRecord> = {},
): PresenceMemberRecord => ({
  clock: 0,
  connectionId: "connection-1",
  userId: "user-1",
  ...overrides,
});

/**
 * TTL purge-on-read, `expired[]` reported exactly once, absent-member reads,
 * removal semantics, per-room isolation, and overwrite-on-set. Every
 * `PresenceStore` adapter (memory, Redis, Durable Object storage) must pass
 * this unmodified.
 */
export const presenceStoreConformance = (
  createStore: () => PresenceStore,
): ConformanceCase[] => [
  {
    name: "getMember returns null for an absent member",
    async run() {
      const store = createStore();
      const member = await store.getMember("room-a", "missing");
      check(member === null, "expected null for an absent member");
    },
  },
  {
    name: "setMember then getMember round-trips the record",
    async run() {
      const store = createStore();
      const member = testMember();
      await store.setMember("room-a", member, 60_000);
      const stored = await store.getMember("room-a", member.connectionId);
      checkEqual(stored, member, "expected the stored member to round-trip");
    },
  },
  {
    name: "setMember overwrites the prior record for the same connectionId",
    async run() {
      const store = createStore();
      await store.setMember("room-a", testMember({ clock: 1 }), 60_000);
      await store.setMember("room-a", testMember({ clock: 2 }), 60_000);
      const page = await store.listMembers("room-a");
      checkEqual(page.members.length, 1, "expected exactly one stored member");
      checkEqual(
        (page.members[0] as PresenceMemberRecord).clock,
        2,
        "expected the latest write to win",
      );
    },
  },
  {
    name: "refreshMember returns false for an absent member",
    async run() {
      const store = createStore();
      const refreshed = await store.refreshMember("room-a", "missing", 60_000);
      check(
        refreshed === false,
        "expected refresh of an absent member to fail",
      );
    },
  },
  {
    name: "refreshMember extends TTL for a live member",
    async run() {
      const store = createStore();
      const member = testMember();
      await store.setMember("room-a", member, TEST_TTL_MS);
      const refreshed = await store.refreshMember(
        "room-a",
        member.connectionId,
        60_000,
      );
      check(refreshed, "expected refresh of a live member to succeed");
      await sleep(TEST_TTL_MS + TEST_TTL_MARGIN_MS);
      const stored = await store.getMember("room-a", member.connectionId);
      check(
        stored !== null,
        "expected the refreshed TTL to keep the member alive",
      );
    },
  },
  {
    name: "removeMember returns the prior record and clears it",
    async run() {
      const store = createStore();
      const member = testMember();
      await store.setMember("room-a", member, 60_000);
      const removed = await store.removeMember("room-a", member.connectionId);
      checkEqual(removed, member, "expected the removed record to be returned");
      const afterRemoval = await store.getMember("room-a", member.connectionId);
      check(
        afterRemoval === null,
        "expected the member to be gone after removal",
      );
    },
  },
  {
    name: "removeMember returns null when nothing was stored",
    async run() {
      const store = createStore();
      const removed = await store.removeMember("room-a", "missing");
      check(removed === null, "expected null when nothing was stored");
    },
  },
  {
    name: "members are isolated per room",
    async run() {
      const store = createStore();
      await store.setMember("room-a", testMember(), 60_000);
      const page = await store.listMembers("room-b");
      checkEqual(
        page.members.length,
        0,
        "expected an unrelated room to be empty",
      );
    },
  },
  {
    name: "a lapsed member is purged on read and reported in expired[]",
    async run() {
      const store = createStore();
      const member = testMember();
      await store.setMember("room-a", member, TEST_TTL_MS);
      await sleep(TEST_TTL_MS + TEST_TTL_MARGIN_MS);
      const page = await store.listMembers("room-a");
      checkEqual(
        page.members.length,
        0,
        "expected the lapsed member to be purged",
      );
      checkEqual(page.expired.length, 1, "expected exactly one expired member");
      checkEqual(
        page.expired[0]?.connectionId,
        member.connectionId,
        "expected the expired entry to identify the lapsed connection",
      );
    },
  },
  {
    name: "a purged member is not reported expired again",
    async run() {
      const store = createStore();
      const member = testMember();
      await store.setMember("room-a", member, TEST_TTL_MS);
      await sleep(TEST_TTL_MS + TEST_TTL_MARGIN_MS);
      await store.listMembers("room-a");
      const second = await store.listMembers("room-a");
      checkEqual(second.expired.length, 0, "expected no repeat expiry report");
    },
  },
];

/**
 * Loopback delivery (required for browser self-suppression by senderId),
 * cross-subscription fan-out, cross-room isolation, idempotent unsubscribe,
 * and frame-identity preservation.
 */
export const presenceFanoutConformance = (
  createFanout: () => PresenceFanout,
): ConformanceCase[] => [
  {
    name: "publish delivers to the publisher's own subscription",
    async run() {
      const fanout = createFanout();
      const received: unknown[] = [];
      await fanout.subscribe("room-a", (broadcast) => {
        received.push(broadcast.frame);
      });
      await fanout.publish({ frame: { hello: "world" }, roomId: "room-a" });
      checkEqual(
        received.length,
        1,
        "expected loopback delivery to the publisher",
      );
    },
  },
  {
    name: "publish delivers to every subscription on the same room",
    async run() {
      const fanout = createFanout();
      let first = 0;
      let second = 0;
      await fanout.subscribe("room-a", () => {
        first += 1;
      });
      await fanout.subscribe("room-a", () => {
        second += 1;
      });
      await fanout.publish({ frame: {}, roomId: "room-a" });
      checkEqual(
        first,
        1,
        "expected the first subscription to receive one delivery",
      );
      checkEqual(
        second,
        1,
        "expected the second subscription to receive one delivery",
      );
    },
  },
  {
    name: "publish does not cross rooms",
    async run() {
      const fanout = createFanout();
      let deliveries = 0;
      await fanout.subscribe("room-a", () => {
        deliveries += 1;
      });
      await fanout.publish({ frame: {}, roomId: "room-b" });
      checkEqual(deliveries, 0, "expected no cross-room delivery");
    },
  },
  {
    name: "unsubscribe stops delivery and is idempotent",
    async run() {
      const fanout = createFanout();
      let deliveries = 0;
      const subscription = await fanout.subscribe("room-a", () => {
        deliveries += 1;
      });
      await subscription.unsubscribe();
      await subscription.unsubscribe();
      await fanout.publish({ frame: {}, roomId: "room-a" });
      checkEqual(deliveries, 0, "expected no delivery after unsubscribe");
    },
  },
  {
    name: "the delivered frame is the exact published value",
    async run() {
      const fanout = createFanout();
      const frame = { marker: "unique" };
      let deliveredFrame: unknown;
      await fanout.subscribe("room-a", (broadcast) => {
        deliveredFrame = broadcast.frame;
      });
      await fanout.publish({ frame, roomId: "room-a" });
      checkEqual(
        deliveredFrame,
        frame,
        "expected the exact frame to be delivered",
      );
    },
  },
];

const testPolicy = (
  overrides: Partial<ConnectionPolicy> = {},
): ConnectionPolicy => ({
  leaseRefreshIntervalMs: 15_000,
  leaseTtlMs: 60_000,
  maxConnectionsPerDocument: 2,
  ...overrides,
});

/**
 * Capacity/duplicate admission, lease refresh-after-release, and idempotent
 * release. Run against both the Redis-backed and Durable-Object-backed
 * adapters as the direct evidence that connection limits do not require a
 * distributed lease in the Durable Object runtime.
 */
export const connectionLimiterConformance = (
  createLimiter: () => ConnectionLimiter,
): ConformanceCase[] => [
  {
    name: "acquire succeeds up to capacity and rejects the next admission",
    async run() {
      const limiter = createLimiter();
      const policy = testPolicy({ maxConnectionsPerDocument: 2 });
      const first = await limiter.acquire({
        documentId: "room-a",
        peerId: "peer-1",
        policy,
        sessionId: "session-1",
      });
      const second = await limiter.acquire({
        documentId: "room-a",
        peerId: "peer-2",
        policy,
        sessionId: "session-2",
      });
      const third = await limiter.acquire({
        documentId: "room-a",
        peerId: "peer-3",
        policy,
        sessionId: "session-3",
      });
      check(first.accepted, "expected the first admission to be accepted");
      check(second.accepted, "expected the second admission to be accepted");
      check(!third.accepted, "expected capacity to reject the third admission");
      if (!third.accepted) {
        checkEqual(third.reason, "capacity", "expected a capacity rejection");
      }
    },
  },
  {
    name: "acquire rejects a duplicate peerId",
    async run() {
      const limiter = createLimiter();
      const policy = testPolicy();
      await limiter.acquire({
        documentId: "room-a",
        peerId: "peer-1",
        policy,
        sessionId: "session-1",
      });
      const duplicate = await limiter.acquire({
        documentId: "room-a",
        peerId: "peer-1",
        policy,
        sessionId: "session-2",
      });
      check(!duplicate.accepted, "expected a duplicate peerId to be rejected");
      if (!duplicate.accepted) {
        checkEqual(
          duplicate.reason,
          "duplicate",
          "expected a duplicate rejection",
        );
      }
    },
  },
  {
    name: "refresh returns false once the lease is released",
    async run() {
      const limiter = createLimiter();
      const admission = await limiter.acquire({
        documentId: "room-a",
        peerId: "peer-1",
        policy: testPolicy(),
        sessionId: "session-1",
      });
      check(admission.accepted, "expected the admission to be accepted");
      if (!admission.accepted) return;
      await admission.lease.release();
      const refreshed = await admission.lease.refresh();
      check(!refreshed, "expected refresh to fail after release");
    },
  },
  {
    name: "release is idempotent",
    async run() {
      const limiter = createLimiter();
      const admission = await limiter.acquire({
        documentId: "room-a",
        peerId: "peer-1",
        policy: testPolicy(),
        sessionId: "session-1",
      });
      check(admission.accepted, "expected the admission to be accepted");
      if (!admission.accepted) return;
      await admission.lease.release();
      await admission.lease.release();
    },
  },
  {
    name: "a released peerId can be re-acquired",
    async run() {
      const limiter = createLimiter();
      const policy = testPolicy();
      const admission = await limiter.acquire({
        documentId: "room-a",
        peerId: "peer-1",
        policy,
        sessionId: "session-1",
      });
      check(admission.accepted, "expected the admission to be accepted");
      if (!admission.accepted) return;
      await admission.lease.release();
      const reacquired = await limiter.acquire({
        documentId: "room-a",
        peerId: "peer-1",
        policy,
        sessionId: "session-2",
      });
      check(
        reacquired.accepted,
        "expected a released peerId to be re-acquirable",
      );
    },
  },
];
