import { describe, expect, it } from "vitest";
import { OPERATION_TYPE } from "../constants/operation-types";
import { EgWalkerReplica } from "../core/replica";
import type { EventId, GraphEvent } from "../types";
import {
  applyInRandomDeliveryOrder,
  canonicalText,
  cloneEvent,
  createPrng,
  shuffled,
} from "./test-helpers";

describe("EgWalkerReplica surrogate-pair boundary cases", () => {
  // A handful of non-BMP code points that the engine should always
  // treat as 2-code-unit atomic units. The convergence property must
  // hold even when an insert sits next to a surrogate pair, and the
  // resulting text must remain well-formed UTF-16 (no lone
  // surrogates).
  const SURROGATE_EMOJI = "\u{1F600}"; // grinning face, UTF-16 length 2
  const HEART = "\u{1F49C}"; // purple heart
  const FLAG = "\u{1F1F8}\u{1F1EA}"; // regional indicator pair (Swedish flag)

  const wellFormedUtf16 = (text: string): boolean => {
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      if (code >= 0xd800 && code <= 0xdbff) {
        const next = i + 1 < text.length ? text.charCodeAt(i + 1) : 0;
        if (next < 0xdc00 || next > 0xdfff) {
          return false;
        }
        i++;
      } else if (code >= 0xdc00 && code <= 0xdfff) {
        return false;
      }
    }
    return true;
  };

  it("rejects inserts that land between the halves of a surrogate pair", () => {
    const replica = new EgWalkerReplica("r1", SURROGATE_EMOJI);
    // Index 1 sits between the high and low surrogate of the emoji.
    expect(() => replica.insert(1, "x")).toThrow(/surrogate halves/);
    // Inserts at the BMP-aligned boundaries (0 and 2) are fine.
    expect(() => replica.insert(0, "x")).not.toThrow();
    expect(() => replica.insert(replica.getText().length, "y")).not.toThrow();
    expect(wellFormedUtf16(replica.getText())).toBe(true);
  });

  it("converges across concurrent inserts around a surrogate pair", () => {
    const events: GraphEvent[] = [
      {
        id: "root:0",
        parentVersion: new Set<EventId>(),
        operation: {
          type: OPERATION_TYPE.INSERT,
          index: 0,
          text: `pre${SURROGATE_EMOJI}post`,
        },
        timestamp: 0,
      },
      {
        id: "alice:0",
        parentVersion: new Set<EventId>(["root:0"]),
        // Insert immediately before the emoji (code-unit index 3).
        operation: { type: OPERATION_TYPE.INSERT, index: 3, text: "A" },
        timestamp: 1,
      },
      {
        id: "bob:0",
        parentVersion: new Set<EventId>(["root:0"]),
        // Insert immediately after the emoji (code-unit index 5).
        operation: { type: OPERATION_TYPE.INSERT, index: 5, text: "B" },
        timestamp: 2,
      },
      {
        id: "carol:0",
        parentVersion: new Set<EventId>(["root:0"]),
        // Insert another surrogate pair right after the existing one.
        operation: { type: OPERATION_TYPE.INSERT, index: 5, text: HEART },
        timestamp: 3,
      },
    ];

    const text = canonicalText(events);
    // Both concurrent atomic inserts and the surrogate-pair-inside
    // edit must produce well-formed UTF-16.
    expect(wellFormedUtf16(text)).toBe(true);
    expect(text.includes(SURROGATE_EMOJI)).toBe(true);
    expect(text.includes(HEART)).toBe(true);
    expect(text.includes("A")).toBe(true);
    expect(text.includes("B")).toBe(true);

    const rand = createPrng(0x6060_6060);
    for (let trial = 0; trial < 8; trial++) {
      const replica = applyInRandomDeliveryOrder(`r-${trial}`, events, rand);
      expect(replica.getText(), `trial=${trial}`).toBe(text);
      expect(wellFormedUtf16(replica.getText())).toBe(true);
    }
  });

  it("converges across concurrent deletes that wrap a surrogate pair", () => {
    // Alice deletes a range that includes the whole emoji; Bob
    // deletes a smaller subset on the same side. Both must agree on
    // the result and never produce a lone surrogate.
    const baseText = `xy${FLAG}zw`;
    const events: GraphEvent[] = [
      {
        id: "root:0",
        parentVersion: new Set<EventId>(),
        operation: { type: OPERATION_TYPE.INSERT, index: 0, text: baseText },
        timestamp: 0,
      },
      {
        id: "alice:0",
        parentVersion: new Set<EventId>(["root:0"]),
        // Delete "y" + the regional-indicator pair (code-unit length 5).
        operation: { type: OPERATION_TYPE.DELETE, index: 1, length: 5 },
        timestamp: 1,
      },
      {
        id: "bob:0",
        parentVersion: new Set<EventId>(["root:0"]),
        // Delete just "y".
        operation: { type: OPERATION_TYPE.DELETE, index: 1, length: 1 },
        timestamp: 2,
      },
    ];

    const text = canonicalText(events);
    expect(wellFormedUtf16(text)).toBe(true);
    // Alice's larger delete dominates: only the trailing "zw"
    // survives because the union of the two deletions removes the
    // whole prefix `y${FLAG}`.
    expect(text).toBe("xzw");

    const rand = createPrng(0x7070_7070);
    for (let trial = 0; trial < 6; trial++) {
      const replica = applyInRandomDeliveryOrder(`r-${trial}`, events, rand);
      expect(replica.getText(), `trial=${trial}`).toBe(text);
      expect(wellFormedUtf16(replica.getText())).toBe(true);
    }
  });
});
