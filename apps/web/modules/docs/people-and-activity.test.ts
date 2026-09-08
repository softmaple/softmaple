import { describe, expect, it } from "vitest";
import type { PresenceUser } from "@softmaple/awareness";
import type { Block, BlockDocument } from "@softmaple/block-model";
import {
  ACTIVITY,
  classifyActivity,
  describePeople,
} from "@/modules/docs/people-and-activity";

const EMPTY_ATTRS = {
  parentId: null,
  language: null,
  theme: null,
  start: null,
  value: null,
  checked: null,
} as const;

const block = (id: string, type: Block["type"], text = ""): Block => ({
  id,
  type,
  text,
  attrs: EMPTY_ATTRS,
  marks: [],
});

const document = {
  schemaVersion: 1,
  blocks: [
    block("h-method", "h2", "Method"),
    block("m1", "paragraph", "A step."),
    block("h-results", "h2", "Results"),
    block("r1", "paragraph", "It converged."),
  ],
} as BlockDocument;

const peer = (
  connectionId: string,
  overrides: Partial<PresenceUser> = {},
): PresenceUser =>
  ({
    connectionId,
    userId: `user-${connectionId}`,
    name: connectionId,
    color: "#123456",
    status: "idle",
    lastActivityAt: 0,
    lastSeenAt: 0,
    clock: 1,
    ...overrides,
  }) as PresenceUser;

describe("classifyActivity", () => {
  it("reads editing, viewing and idle from the person's own signals", () => {
    expect(classifyActivity(peer("a", { meta: { isTyping: true } }))).toBe(
      ACTIVITY.Editing,
    );
    expect(classifyActivity(peer("b", { status: "active" }))).toBe(
      ACTIVITY.Viewing,
    );
    expect(classifyActivity(peer("c"))).toBe(ACTIVITY.Idle);
  });

  it("does not treat an active reader as an editor", () => {
    expect(
      classifyActivity(
        peer("d", { status: "active", meta: { isTyping: false } }),
      ),
    ).toBe(ACTIVITY.Viewing);
  });
});

describe("describePeople", () => {
  const cursorIn = (blockId: string) => ({
    blockId,
    anchor: { type: "boundary", edge: "start", affinity: "after" } as const,
  });

  it("names the section a person is in", () => {
    const [first, second] = describePeople({
      document,
      people: [
        peer("a", { cursor: cursorIn("m1") }),
        peer("b", { cursor: cursorIn("r1") }),
      ],
      selfConnectionId: null,
      theme: "light",
    });
    expect(first?.location).toBe("in Method");
    expect(second?.location).toBe("in Results");
  });

  it("says only what it knows when there is no position", () => {
    const [only] = describePeople({
      document,
      people: [peer("a")],
      selfConnectionId: null,
      theme: "light",
    });
    expect(only?.location).toBe("in this document");
  });

  it("degrades to the document when the outline is not loaded", () => {
    const [only] = describePeople({
      document: null,
      people: [peer("a", { cursor: cursorIn("m1") })],
      selfConnectionId: null,
      theme: "light",
    });
    expect(only?.location).toBe("in this document");
  });

  it("marks the local session and paints identities for the theme", () => {
    const [self, other] = describePeople({
      document,
      people: [peer("me"), peer("them")],
      selfConnectionId: "me",
      theme: "dark",
    });
    expect(self?.isSelf).toBe(true);
    expect(other?.isSelf).toBe(false);
    expect(self?.color).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("keeps everybody, however many there are", () => {
    const many = Array.from({ length: 40 }, (_unused, index) =>
      peer(`c${index}`),
    );
    expect(
      describePeople({
        document,
        people: many,
        selfConnectionId: null,
        theme: "light",
      }),
    ).toHaveLength(40);
  });
});
