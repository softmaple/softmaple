import { createBlockReplica } from "@softmaple/block-model";
import { describe, expect, it } from "vitest";
import {
  DOCUMENT_FIXTURES,
  FIXTURE_KIND,
  fixtureEventBatches,
  fixtureWordCount,
} from "@/lib/seeding/seed-fixtures";

const byKind = (kind: string) => {
  const fixture = DOCUMENT_FIXTURES.find((entry) => entry.kind === kind);
  if (fixture === undefined) throw new Error(`Missing fixture ${kind}`);
  return fixture;
};

describe("document fixtures", () => {
  it("covers private, shared, mixed-language and long documents", () => {
    expect(DOCUMENT_FIXTURES.map((fixture) => fixture.kind)).toEqual([
      FIXTURE_KIND.Draft,
      FIXTURE_KIND.Shared,
      FIXTURE_KIND.MixedLanguage,
      FIXTURE_KIND.Long,
    ]);
    expect(byKind(FIXTURE_KIND.Draft).isPublic).toBe(false);
    expect(byKind(FIXTURE_KIND.Shared).isPublic).toBe(true);
  });

  it("uses unique slugs", () => {
    const slugs = DOCUMENT_FIXTURES.map((fixture) => fixture.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("replays into batches a fresh replica can integrate", () => {
    const fixture = byKind(FIXTURE_KIND.MixedLanguage);
    const batches = fixtureEventBatches(fixture, "seed-replica");
    expect(batches).toHaveLength(fixture.blocks.length);

    const replica = createBlockReplica("reader");
    const result = replica.applyRemoteEvents(batches);
    expect(result.pendingBatchIds).toHaveLength(0);

    const text = replica
      .getDocument()
      .blocks.map((block) => block.text)
      .join("\n");
    for (const block of fixture.blocks) {
      expect(text).toContain(block.text);
    }
  });

  it("preserves document order across separate batches", () => {
    const fixture = byKind(FIXTURE_KIND.Shared);
    const replica = createBlockReplica("reader");
    replica.applyRemoteEvents(fixtureEventBatches(fixture, "seed-replica"));
    expect(
      replica
        .getDocument()
        .blocks.map((block) => block.text)
        .filter((text) => text.length > 0),
    ).toEqual(fixture.blocks.map((block) => block.text));
  });

  it("makes the long fixture substantially longer than the draft", () => {
    expect(fixtureWordCount(byKind(FIXTURE_KIND.Long))).toBeGreaterThan(
      10 * fixtureWordCount(byKind(FIXTURE_KIND.Draft)),
    );
  });
});
