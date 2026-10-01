import { performance } from "node:perf_hooks";

import {
  EgWalkerReplica,
  type EventId,
  type GraphEvent,
} from "@softmaple/eg-walker";
import {
  ColumnarEventGraphCodec,
  encodeTopologicallyOrderedEventsBinary,
} from "@softmaple/eg-walker/internal";

import { assertFinalText, type FinalTextOracle } from "./paper-final-text";

export interface NativePaperPayload {
  readonly binary: Uint8Array;
  readonly eventCount: number;
  readonly frontier: ReadonlyArray<EventId>;
  readonly finalTextOracle: FinalTextOracle | undefined;
}

export interface NativePaperLoadMetrics {
  readonly binaryBytes: number;
  readonly eventCount: number;
  readonly frontierSize: number;
  readonly finalTextLength: number;
  readonly finalTextValidated: boolean;
  readonly finalTextOracle: FinalTextOracle["kind"] | undefined;
  readonly nativeDecodeMs: number;
  readonly nativeLoadMs: number;
  readonly nativeMaterializeMs: number;
  readonly heapBeforeDecodeBytes: number;
  readonly arrayBuffersBeforeDecodeBytes: number;
  readonly rssBeforeDecodeBytes: number;
  readonly heapAfterDecodeBytes: number;
  readonly arrayBuffersAfterDecodeBytes: number;
  readonly rssAfterDecodeBytes: number;
  readonly heapAfterLoadBytes: number;
  readonly arrayBuffersAfterLoadBytes: number;
  readonly rssAfterLoadBytes: number;
  readonly nativeDecodeHeapBytes: number;
  readonly nativeLoadHeapBytes: number;
  readonly nativeTotalHeapBytes: number;
  readonly nativeDecodeArrayBufferBytes: number;
  readonly nativeLoadArrayBufferBytes: number;
  readonly nativeTotalArrayBufferBytes: number;
  readonly replayStats: ReturnType<EgWalkerReplica["getReplayStats"]>;
}

interface ProcessMemorySample {
  readonly heapUsed: number;
  readonly arrayBuffers: number;
  readonly rss: number;
}

/**
 * Build the native EGW4 payload outside the timed load lane. Paper trace
 * conversion already emits events in causal order, so the direct encoder can
 * validate and persist that order without constructing a second graph.
 */
export const buildNativePaperPayload = (
  events: ReadonlyArray<GraphEvent>,
  finalTextOracle?: FinalTextOracle,
): NativePaperPayload => {
  const encoded = encodeTopologicallyOrderedEventsBinary(events);
  return {
    binary: encoded.binary,
    eventCount: events.length,
    frontier: [...encoded.frontier].sort(),
    finalTextOracle,
  };
};

/**
 * Measure the persistence boundary comparable to native Yjs/Yrs/Automerge
 * payload loading: decode EGW4, restore/replay the replica, then materialize
 * its final plain text. Payload generation is deliberately not timed here.
 */
export const measureNativePaperPayload = (
  payload: NativePaperPayload,
  replicaId: string,
  collectGarbage: () => void = () => undefined,
): NativePaperLoadMetrics => {
  const codec = new ColumnarEventGraphCodec();

  collectGarbage();
  const memoryBeforeDecode = sampleProcessMemory();
  const decodeStartedAt = performance.now();
  const graph = codec.decodeBinary(payload.binary);
  const decodedAt = performance.now();

  // The decoder timing stops before collection. The retained decoded graph is
  // then sampled and becomes the baseline for the separately timed load lane.
  collectGarbage();
  const memoryAfterDecode = sampleProcessMemory();

  if (graph.getEventCount() !== payload.eventCount) {
    throw new Error(
      `${replicaId}: decoded ${graph.getEventCount()} events, expected ${payload.eventCount}`,
    );
  }
  const frontier = Array.from(graph.getFrontier()).sort();
  if (!sameIds(frontier, payload.frontier)) {
    throw new Error(`${replicaId}: decoded frontier does not match payload`);
  }

  const loadStartedAt = performance.now();
  const replica = new EgWalkerReplica(replicaId, "", graph);
  const loadedAt = performance.now();
  const text = replica.getText();
  const materializedAt = performance.now();

  collectGarbage();
  const memoryAfterLoad = sampleProcessMemory();

  if (payload.finalTextOracle !== undefined) {
    try {
      assertFinalText(replicaId, text, payload.finalTextOracle);
    } catch (error) {
      throw new Error(
        [
          error instanceof Error ? error.message : String(error),
          `binaryBytes=${payload.binary.byteLength}`,
          `nativeDecodeMs=${decodedAt - decodeStartedAt}`,
          `nativeLoadMs=${loadedAt - loadStartedAt}`,
          `nativeMaterializeMs=${materializedAt - loadedAt}`,
          `nativeDecodeHeapBytes=${memoryAfterDecode.heapUsed - memoryBeforeDecode.heapUsed}`,
          `nativeLoadHeapBytes=${memoryAfterLoad.heapUsed - memoryAfterDecode.heapUsed}`,
        ].join("; "),
        { cause: error },
      );
    }
  }

  return {
    binaryBytes: payload.binary.byteLength,
    eventCount: payload.eventCount,
    frontierSize: frontier.length,
    finalTextLength: text.length,
    finalTextValidated: payload.finalTextOracle !== undefined,
    finalTextOracle: payload.finalTextOracle?.kind,
    nativeDecodeMs: decodedAt - decodeStartedAt,
    nativeLoadMs: loadedAt - loadStartedAt,
    nativeMaterializeMs: materializedAt - loadedAt,
    heapBeforeDecodeBytes: memoryBeforeDecode.heapUsed,
    arrayBuffersBeforeDecodeBytes: memoryBeforeDecode.arrayBuffers,
    rssBeforeDecodeBytes: memoryBeforeDecode.rss,
    heapAfterDecodeBytes: memoryAfterDecode.heapUsed,
    arrayBuffersAfterDecodeBytes: memoryAfterDecode.arrayBuffers,
    rssAfterDecodeBytes: memoryAfterDecode.rss,
    heapAfterLoadBytes: memoryAfterLoad.heapUsed,
    arrayBuffersAfterLoadBytes: memoryAfterLoad.arrayBuffers,
    rssAfterLoadBytes: memoryAfterLoad.rss,
    nativeDecodeHeapBytes:
      memoryAfterDecode.heapUsed - memoryBeforeDecode.heapUsed,
    nativeLoadHeapBytes: memoryAfterLoad.heapUsed - memoryAfterDecode.heapUsed,
    nativeTotalHeapBytes:
      memoryAfterLoad.heapUsed - memoryBeforeDecode.heapUsed,
    nativeDecodeArrayBufferBytes:
      memoryAfterDecode.arrayBuffers - memoryBeforeDecode.arrayBuffers,
    nativeLoadArrayBufferBytes:
      memoryAfterLoad.arrayBuffers - memoryAfterDecode.arrayBuffers,
    nativeTotalArrayBufferBytes:
      memoryAfterLoad.arrayBuffers - memoryBeforeDecode.arrayBuffers,
    replayStats: replica.getReplayStats(),
  };
};

const sampleProcessMemory = (): ProcessMemorySample => {
  const memory = process.memoryUsage();
  return {
    heapUsed: memory.heapUsed,
    arrayBuffers: memory.arrayBuffers,
    rss: memory.rss,
  };
};

const sameIds = (
  left: ReadonlyArray<EventId>,
  right: ReadonlyArray<EventId>,
): boolean =>
  left.length === right.length &&
  left.every((eventId, index) => eventId === right[index]);
