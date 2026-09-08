import { createBlockReplica } from "@softmaple/block-model";
import type { BlockInput, RichTextEventBatch } from "@softmaple/block-model";

/**
 * Document fixtures for local verification.
 *
 * Content is produced the only way the product produces it: by driving a real
 * `BlockReplica` and keeping the event batches it emits. Seeded documents are
 * therefore replayable by the same code path a browser uses, rather than being
 * a hand-written payload that only resembles one.
 */

export const FIXTURE_KIND = {
  /** A short private draft — the everyday case. */
  Draft: "draft",
  /** Public-link enabled, so live collaboration is reachable. */
  Shared: "shared",
  /** Latin, CJK, RTL and combining marks in one document. */
  MixedLanguage: "mixed-language",
  /** Long enough to exercise virtualised outline and scroll anchoring. */
  Long: "long",
} as const;

export type FixtureKind = (typeof FIXTURE_KIND)[keyof typeof FIXTURE_KIND];

export type DocumentFixture = {
  readonly kind: FixtureKind;
  readonly isPublic: boolean;
  readonly slug: string;
  readonly title: string;
  /** Paragraph and heading text, in document order. */
  readonly blocks: ReadonlyArray<BlockInput>;
};

const paragraph = (text: string): BlockInput => ({ type: "paragraph", text });
const heading = (text: string, level: 1 | 2 | 3): BlockInput => ({
  type: `h${level}`,
  text,
});

const LONG_SECTION_COUNT = 24;
const LONG_PARAGRAPHS_PER_SECTION = 6;

const longDocumentBlocks = (): ReadonlyArray<BlockInput> =>
  Array.from({ length: LONG_SECTION_COUNT }).flatMap((_unused, section) => [
    heading(`Section ${section + 1}`, 2),
    ...Array.from({ length: LONG_PARAGRAPHS_PER_SECTION }).map(
      (_paragraph, index) =>
        paragraph(
          `Section ${section + 1}, paragraph ${index + 1}. ` +
            "Typesetting a long manuscript means the outline, the caret and " +
            "every remote collaborator have to stay put while the text under " +
            "them changes. This paragraph exists to make that measurable.",
        ),
    ),
  ]);

/** The documents every seeded workspace receives, in a stable order. */
export const DOCUMENT_FIXTURES: ReadonlyArray<DocumentFixture> = [
  {
    kind: FIXTURE_KIND.Draft,
    isPublic: false,
    slug: "shared-notes",
    title: "Shared notes",
    blocks: [
      heading("Shared notes", 1),
      paragraph(
        "A private draft. Only workspace members can open this document, and " +
          "live collaboration stays off until a public link is enabled.",
      ),
      paragraph("Second paragraph, so selection spans more than one block."),
    ],
  },
  {
    kind: FIXTURE_KIND.Shared,
    isPublic: true,
    slug: "public-review",
    title: "Public review",
    blocks: [
      heading("Public review", 1),
      paragraph(
        "This document has a public link, so presence and shared attention " +
          "are reachable here.",
      ),
      heading("Method", 2),
      paragraph(
        "Two independent browser sessions open this document and edit the " +
          "same paragraph at once.",
      ),
      heading("Results", 2),
      paragraph("Convergence is checked against both runtimes."),
    ],
  },
  {
    kind: FIXTURE_KIND.MixedLanguage,
    isPublic: true,
    slug: "mixed-language",
    title: "Mixed language sample",
    blocks: [
      heading("Mixed language sample", 1),
      paragraph("English sentence with a trailing space. "),
      paragraph("中文段落：协作编辑需要正确处理宽字符与输入法组合。"),
      paragraph("日本語の段落です。IME の変換中はキャレットを動かしません。"),
      paragraph("فقرة عربية لاختبار اتجاه النص من اليمين إلى اليسار."),
      paragraph("Combining marks: é à ñ — and emoji: 🍁🇯🇵👩‍👩‍👧."),
    ],
  },
  {
    kind: FIXTURE_KIND.Long,
    isPublic: false,
    slug: "long-manuscript",
    title: "Long manuscript",
    blocks: [heading("Long manuscript", 1), ...longDocumentBlocks()],
  },
] as const;

/**
 * Replay a fixture into event batches.
 *
 * One batch per block keeps the seeded history shaped like real typing rather
 * than a single monolithic insert, so repair paging and cursor stability have
 * something to page through.
 */
export const fixtureEventBatches = (
  fixture: DocumentFixture,
  replicaId: string,
): ReadonlyArray<RichTextEventBatch> => {
  const replica = createBlockReplica(replicaId);
  const batches: RichTextEventBatch[] = [];
  let previousBlockId: string | null = null;

  for (const block of fixture.blocks) {
    const batch = replica.transact((transaction) => {
      previousBlockId = transaction.insertBlock(previousBlockId, block);
    });
    if (batch !== null) batches.push(batch);
  }

  return batches;
};

/** Word count of a fixture, for the measured-validation fixtures table. */
export const fixtureWordCount = (fixture: DocumentFixture): number =>
  fixture.blocks.reduce(
    (total, block) => total + block.text.split(/\s+/u).filter(Boolean).length,
    0,
  );
