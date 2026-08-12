import { describe, it } from "vitest";
import {
  DEFAULT_PRESENCE_ROOM_POLICY,
  createPresenceRoom,
  type PresenceRoomPolicy,
} from "../src";
import {
  createMemoryConnectionLimiter,
  createMemoryPresenceFanout,
  createMemoryPresenceStore,
  createOpaqueTestCodec,
  createStubPresenceSessionHooks,
  PRESENCE_CONFORMANCE_ROOM_ID,
  presenceRoomConformance,
  type PresenceRoomConformanceOptions,
  type PresenceRoomHarness,
} from "../src/testing";

const createHarness = (
  options?: PresenceRoomConformanceOptions,
): PresenceRoomHarness => {
  const store = createMemoryPresenceStore();
  const fanout = createMemoryPresenceFanout();
  const connections = createMemoryConnectionLimiter();
  const sessions = createStubPresenceSessionHooks();
  const policy: PresenceRoomPolicy = {
    ...DEFAULT_PRESENCE_ROOM_POLICY,
    ...(options?.heartbeatExpiryMs === undefined
      ? {}
      : { heartbeatExpiryMs: options.heartbeatExpiryMs }),
    ...(options?.memberTtlMs === undefined
      ? {}
      : { memberTtlMs: options.memberTtlMs }),
  };
  const room = createPresenceRoom(
    PRESENCE_CONFORMANCE_ROOM_ID,
    {
      codec: createOpaqueTestCodec(),
      connections,
      fanout,
      policy,
      sessions,
      store,
    },
    options,
  );
  return { connections, fanout, room, sessions, store };
};

describe("PresenceRoom conformance", () => {
  for (const testCase of presenceRoomConformance(createHarness)) {
    it(testCase.name, testCase.run);
  }
});
