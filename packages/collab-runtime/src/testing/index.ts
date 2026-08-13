export {
  check,
  checkEqual,
  expectRejection,
  type ConformanceCase,
} from "./conformance-case";
export {
  connectionLimiterConformance,
  documentEventStoreConformance,
  presenceFanoutConformance,
  presenceStoreConformance,
} from "./capability-conformance";
export {
  TEST_PRESENCE_WIRE_TYPE,
  createMemoryConnectionLimiter,
  createMemoryDocumentEventStore,
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
  presenceRoomConformance,
  type PresenceRoomFactory,
  type PresenceRoomHarness,
} from "./presence-room-conformance";
