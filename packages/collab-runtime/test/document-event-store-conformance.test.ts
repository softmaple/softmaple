import { describe, it } from "vitest";
import {
  createMemoryDocumentEventStore,
  documentEventStoreConformance,
} from "../src/testing";

describe("document event store (memory)", () => {
  for (const testCase of documentEventStoreConformance(() =>
    createMemoryDocumentEventStore(),
  )) {
    it(testCase.name, testCase.run);
  }
});
