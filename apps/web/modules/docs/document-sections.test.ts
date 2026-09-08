import { describe, expect, it } from "vitest";
import type { Block, BlockDocument } from "@softmaple/block-model";
import {
  describeLocation,
  documentSections,
  nearestSection,
  OPENING_SECTION_TITLE,
  sectionForBlock,
} from "@/modules/docs/document-sections";

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

const documentOf = (blocks: ReadonlyArray<Block>): BlockDocument =>
  ({ schemaVersion: 1, blocks }) as BlockDocument;

const sample = documentOf([
  block("intro", "paragraph", "Before any heading."),
  block("h-method", "h2", "Method"),
  block("m1", "paragraph", "First step."),
  block("m2", "paragraph", "Second step."),
  block("h-results", "h2", "Results"),
  block("r1", "paragraph", "It converged."),
]);

describe("documentSections", () => {
  it("keeps content before the first heading in its own section", () => {
    const [opening] = documentSections(sample);
    expect(opening?.title).toBe(OPENING_SECTION_TITLE);
    expect(opening?.headingBlockId).toBeNull();
    expect(opening?.blockIds).toEqual(["intro"]);
  });

  it("groups each heading with the blocks that follow it", () => {
    const sections = documentSections(sample);
    expect(sections.map((section) => section.title)).toEqual([
      OPENING_SECTION_TITLE,
      "Method",
      "Results",
    ]);
    expect(sections[1]?.blockIds).toEqual(["h-method", "m1", "m2"]);
  });

  it("gives an empty heading a readable name", () => {
    const sections = documentSections(documentOf([block("h", "h1", "   ")]));
    expect(sections[0]?.title).toBe("Untitled section");
  });

  it("returns nothing for an empty document", () => {
    expect(documentSections(documentOf([]))).toEqual([]);
  });
});

describe("sectionForBlock", () => {
  it("finds the section a block belongs to", () => {
    const sections = documentSections(sample);
    expect(sectionForBlock(sections, "m2")?.title).toBe("Method");
    expect(sectionForBlock(sections, "h-results")?.title).toBe("Results");
    expect(sectionForBlock(sections, "gone")).toBeNull();
  });
});

describe("nearestSection", () => {
  const sections = documentSections(sample);

  it("prefers the section the block is actually in", () => {
    expect(nearestSection(sections, "r1")?.title).toBe("Results");
  });

  it("falls back to the remembered position when the block is gone", () => {
    expect(nearestSection(sections, "deleted", 1)?.title).toBe("Method");
  });

  it("clamps a remembered position past the end of a shortened document", () => {
    expect(nearestSection(sections, "deleted", 99)?.title).toBe("Results");
  });

  it("falls back to the start when nothing else is known", () => {
    expect(nearestSection(sections, null)?.title).toBe(OPENING_SECTION_TITLE);
    expect(nearestSection(sections, "deleted")?.title).toBe(
      OPENING_SECTION_TITLE,
    );
  });

  it("never invents a location in an empty document", () => {
    expect(nearestSection([], "anything", 0)).toBeNull();
  });
});

describe("describeLocation", () => {
  it("names the section, or says nothing more than it can", () => {
    expect(describeLocation(documentSections(sample)[1] ?? null)).toBe(
      "in Method",
    );
    expect(describeLocation(null)).toBe("in this document");
  });
});
