import { describe, expect, it } from "vitest";
import { createPresenceUser } from "@softmaple/awareness";
import {
  relevantParticipants,
  sectionForParticipant,
} from "./presence-relevance";
const person = (id: string, blockId: string) => ({
  ...createPresenceUser({
    userId: id,
    connectionId: id,
    name: id,
    color: "#175bb5",
  }),
  cursor: {
    blockId,
    anchor: { type: "boundary", edge: "start", affinity: "after" } as const,
  },
});
describe("quiet semantic presence", () => {
  it("prioritizes nearby people before the five-person measurement cap", () => {
    const ids = Array.from({ length: 12 }, (_, index) => `block-${index}`);
    const people = ids.map((id, index) => person(`person-${index}`, id));
    const selected = relevantParticipants(people, ids, "block-9");
    expect(selected).toHaveLength(5);
    expect(selected[0]?.userId).toBe("person-9");
    expect(people).toHaveLength(12);
    expect(
      relevantParticipants(
        [{ ...people[0]!, meta: { foreground: false } }],
        ids,
        ids[0],
      ),
    ).toEqual([]);
  });
  it("never invents a section for an unavailable or hidden location", () => {
    const blocks = [
      { id: "heading", type: "h2", text: "Evidence" },
      { id: "body", type: "paragraph", text: "Notes" },
    ];
    expect(sectionForParticipant(person("a", "body"), blocks)).toBe("Evidence");
    expect(sectionForParticipant(person("b", "deleted"), blocks)).toBeNull();
    expect(
      sectionForParticipant(
        { ...person("c", "body"), meta: { foreground: false } },
        blocks,
      ),
    ).toBeNull();
  });
});
