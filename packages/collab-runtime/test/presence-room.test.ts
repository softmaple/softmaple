import { describe, it } from "vitest";
import {
  DEFAULT_PRESENCE_ROOM_POLICY,
  createPresenceRoom,
  type PresenceRoomOptions,
} from "../src";
import {
  createMemoryConnectionLimiter,
  createMemoryPresenceFanout,
  createMemoryPresenceStore,
  createOpaqueTestCodec,
  createStubPresenceSessionHooks,
  presenceRoomConformance,
  type PresenceRoomHarness,
} from "../src/testing";

const createHarness = (options?: PresenceRoomOptions): PresenceRoomHarness => {
  const store = createMemoryPresenceStore();
  const fanout = createMemoryPresenceFanout();
  const connections = createMemoryConnectionLimiter();
  const sessions = createStubPresenceSessionHooks();
  const room = createPresenceRoom(
    "room-a",
    {
      codec: createOpaqueTestCodec(),
      connections,
      fanout,
      policy: DEFAULT_PRESENCE_ROOM_POLICY,
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
