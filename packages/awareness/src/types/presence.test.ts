import { describe, expect, it } from "vitest";
import {
  createPresenceUser,
  type DirectionalSelectionRange,
  getCursorOffset,
  isCursorPosition,
  isDirectionalSelectionRange,
  isLegacySelectionRange,
  isOffsetCursorPosition,
  isPresenceSelection,
  isSequenceAnchor,
  isStableCursor,
  isStableCursorPosition,
  normalizeCursorPosition,
  normalizePresenceSelection,
  selectionReferencesBlock,
} from "./presence";

const directionalSelection = {
  anchor: {
    blockId: "paragraph-2",
    anchor: {
      type: "atom",
      eventId: "peer-b:7",
      offset: 4,
      affinity: "after",
    },
  },
  focus: {
    blockId: "paragraph-1",
    anchor: {
      type: "boundary",
      edge: "start",
      affinity: "after",
    },
  },
} satisfies DirectionalSelectionRange;

describe("presence selections", () => {
  it("keeps the legacy textarea range compatible", () => {
    const selection = { blockId: "textarea", from: 2, to: 8 };
    const user = createPresenceUser({
      userId: "legacy",
      name: "Legacy",
      color: "#000",
      selection,
    });

    expect(isLegacySelectionRange(selection)).toBe(true);
    expect(isPresenceSelection(selection)).toBe(true);
    expect(user.selection).toEqual(selection);
  });

  it("accepts backwards cross-block stable ranges", () => {
    expect(isDirectionalSelectionRange(directionalSelection)).toBe(true);
    expect(isPresenceSelection(directionalSelection)).toBe(true);
    expect(isLegacySelectionRange(directionalSelection)).toBe(false);
    expect(selectionReferencesBlock(directionalSelection, "paragraph-2")).toBe(
      true,
    );
    expect(selectionReferencesBlock(directionalSelection, "paragraph-1")).toBe(
      true,
    );
    expect(selectionReferencesBlock(directionalSelection, "paragraph-3")).toBe(
      false,
    );
  });

  it("validates atom and canonical boundary anchors", () => {
    expect(isSequenceAnchor(directionalSelection.anchor.anchor)).toBe(true);
    expect(isSequenceAnchor(directionalSelection.focus.anchor)).toBe(true);
    expect(
      isSequenceAnchor({
        type: "boundary",
        edge: "start",
        affinity: "before",
      }),
    ).toBe(false);
    expect(
      isSequenceAnchor({
        type: "atom",
        eventId: "",
        offset: -1,
        affinity: "after",
      }),
    ).toBe(false);
  });

  it("normalizes JSON data into a clean, detached representation", () => {
    const wireValue = JSON.parse(
      JSON.stringify({
        ...directionalSelection,
        ignored: true,
        anchor: { ...directionalSelection.anchor, ignored: true },
      }),
    );

    const normalized = normalizePresenceSelection(wireValue);

    expect(normalized).toEqual(directionalSelection);
    expect(normalized).not.toBe(wireValue);
    if (normalized !== null && isDirectionalSelectionRange(normalized)) {
      expect(normalized.anchor).not.toBe(wireValue.anchor);
      expect(normalized.anchor.anchor).not.toBe(wireValue.anchor.anchor);
    }
  });

  it("rejects malformed legacy and directional values", () => {
    expect(
      normalizePresenceSelection({ blockId: "p", from: 0, to: "4" }),
    ).toBeNull();
    expect(
      normalizePresenceSelection({
        ...directionalSelection,
        focus: { blockId: "paragraph-1", anchor: { type: "boundary" } },
      }),
    ).toBeNull();
  });

  it("ignores malformed runtime selections when matching blocks", () => {
    expect(selectionReferencesBlock({ anchor: null }, "paragraph-1")).toBe(
      false,
    );
    expect(selectionReferencesBlock("invalid", "paragraph-1")).toBe(false);
  });
});

describe("presence cursors", () => {
  const boundaryAnchor = {
    type: "boundary" as const,
    edge: "start" as const,
    affinity: "after" as const,
  };
  const atomAnchor = {
    type: "atom" as const,
    eventId: "e1",
    offset: 2,
    affinity: "before" as const,
  };

  it("distinguishes offset and stable cursor forms", () => {
    const offset = { blockId: "b", offset: 3 };
    const stable = { blockId: "b", anchor: boundaryAnchor };
    const stableWithOffset = {
      blockId: "b",
      anchor: atomAnchor,
      offset: 4,
    };

    expect(isOffsetCursorPosition(offset)).toBe(true);
    expect(isStableCursorPosition(stable)).toBe(true);
    expect(isStableCursorPosition(stableWithOffset)).toBe(true);
    expect(isCursorPosition(offset)).toBe(true);
    expect(isCursorPosition(stable)).toBe(true);
    expect(isOffsetCursorPosition(stable)).toBe(false);
    expect(isStableCursor(offset)).toBe(false);
    expect(isStableCursor(stable)).toBe(true);
    expect(getCursorOffset(offset)).toBe(3);
    expect(getCursorOffset(stable)).toBeUndefined();
    expect(getCursorOffset(stableWithOffset)).toBe(4);
  });

  it("normalizes cursor JSON into detached copies", () => {
    const wireStable = JSON.parse(
      JSON.stringify({
        blockId: "b",
        anchor: atomAnchor,
        offset: 1,
        ignored: true,
      }),
    );
    const normalizedStable = normalizeCursorPosition(wireStable);
    expect(normalizedStable).toEqual({
      blockId: "b",
      anchor: atomAnchor,
      offset: 1,
    });
    expect(normalizedStable).not.toBe(wireStable);

    const wireOffset = { blockId: "b", offset: 9 };
    expect(normalizeCursorPosition(wireOffset)).toEqual(wireOffset);
    expect(normalizeCursorPosition({ blockId: "b" })).toBeNull();
    expect(
      normalizeCursorPosition({
        blockId: "b",
        anchor: { type: "boundary", edge: "start" },
      }),
    ).toBeNull();
  });

  it("normalizes boundary end anchors on stable cursors", () => {
    const end = normalizeCursorPosition({
      blockId: "b",
      anchor: { type: "boundary", edge: "end", affinity: "before" },
    });
    expect(end).toEqual({
      blockId: "b",
      anchor: { type: "boundary", edge: "end", affinity: "before" },
    });
  });
});
