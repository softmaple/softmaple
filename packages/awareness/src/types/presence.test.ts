import { describe, expect, it } from "vitest";
import {
  createPresenceUser,
  type DirectionalSelectionRange,
  isDirectionalSelectionRange,
  isLegacySelectionRange,
  isPresenceSelection,
  isSequenceAnchor,
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
