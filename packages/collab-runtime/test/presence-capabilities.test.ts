import { describe, it } from "vitest";
import {
  connectionLimiterConformance,
  createMemoryConnectionLimiter,
  createMemoryPresenceFanout,
  createMemoryPresenceStore,
  presenceFanoutConformance,
  presenceStoreConformance,
} from "../src/testing";

describe("presence store (memory)", () => {
  for (const testCase of presenceStoreConformance(() =>
    createMemoryPresenceStore(),
  )) {
    it(testCase.name, testCase.run);
  }
});

describe("presence fanout (memory)", () => {
  for (const testCase of presenceFanoutConformance(() =>
    createMemoryPresenceFanout(),
  )) {
    it(testCase.name, testCase.run);
  }
});

describe("presence connection limiter (memory)", () => {
  for (const testCase of connectionLimiterConformance(() =>
    createMemoryConnectionLimiter(),
  )) {
    it(testCase.name, testCase.run);
  }
});
