export {
  check,
  checkEqual,
  type ConformanceCase,
} from "./conformance-case";
export {
  connectionLimiterConformance,
  presenceFanoutConformance,
  presenceStoreConformance,
  type PresenceStoreConformanceOptions,
} from "./capability-conformance";
export {
  TEST_PRESENCE_WIRE_TYPE,
  createMemoryConnectionLimiter,
  createMemoryPresenceFanout,
  createMemoryPresenceStore,
  createOpaqueTestCodec,
  createRecordingPresencePeer,
  createStubPresenceSessionHooks,
  type MemoryConnectionLimiterOptions,
  type RecordingPresencePeer,
  type StubPresenceSessionHooks,
} from "./fakes";
export {
  PRESENCE_CONFORMANCE_ROOM_ID,
  presenceRoomConformance,
  type PresenceRoomConformanceOptions,
  type PresenceRoomFactory,
  type PresenceRoomHarness,
} from "./presence-room-conformance";
