import type { Block, BlockDocument, BlockId } from "@softmaple/block-model";

/**
 * The document's outline, and where a person is inside it.
 *
 * "Somebody is editing" is not useful in a long manuscript; "somebody is
 * editing in Results" is. A section is the nearest heading at or above a
 * block, which is also exactly the anchor a return journey needs when the
 * block a person left has since been deleted.
 */

const HEADING_LEVEL: Readonly<Record<string, 1 | 2 | 3>> = {
  h1: 1,
  h2: 2,
  h3: 3,
};

export type DocumentSection = {
  /** The heading block, or `null` for the implicit opening section. */
  readonly headingBlockId: BlockId | null;
  readonly level: 1 | 2 | 3;
  /** Blocks belonging to this section, heading included, in order. */
  readonly blockIds: ReadonlyArray<BlockId>;
  readonly title: string;
};

/** The title used for content that appears before the first heading. */
export const OPENING_SECTION_TITLE = "Opening";

const headingLevel = (block: Block): 1 | 2 | 3 | null =>
  HEADING_LEVEL[block.type] ?? null;

/**
 * Split a document into sections.
 *
 * Content before the first heading is its own section rather than being
 * dropped, so every block belongs somewhere and no location can fail to
 * resolve for want of a heading.
 */
export const documentSections = (
  document: BlockDocument,
): ReadonlyArray<DocumentSection> => {
  const sections: DocumentSection[] = [];
  let current: {
    headingBlockId: BlockId | null;
    level: 1 | 2 | 3;
    blockIds: BlockId[];
    title: string;
  } | null = null;

  const flush = (): void => {
    if (current === null) return;
    sections.push(Object.freeze({ ...current, blockIds: current.blockIds }));
    current = null;
  };

  for (const block of document.blocks) {
    const level = headingLevel(block);
    if (level !== null) {
      flush();
      current = {
        headingBlockId: block.id,
        level,
        blockIds: [block.id],
        // A heading with no text still needs a name a person can read out.
        title:
          block.text.trim().length > 0 ? block.text.trim() : "Untitled section",
      };
      continue;
    }
    if (current === null) {
      current = {
        headingBlockId: null,
        level: 1,
        blockIds: [],
        title: OPENING_SECTION_TITLE,
      };
    }
    current.blockIds.push(block.id);
  }
  flush();
  return Object.freeze(sections);
};

/** The section containing a block, or `null` when the block is not present. */
export const sectionForBlock = (
  sections: ReadonlyArray<DocumentSection>,
  blockId: BlockId,
): DocumentSection | null =>
  sections.find((section) => section.blockIds.includes(blockId)) ?? null;

/**
 * Resolve a location to the nearest section that still exists.
 *
 * This is the fallback a return anchor uses when the block somebody left has
 * been deleted: prefer the section that block was in, then the section that
 * preceded it, and finally the start of the document. It never invents a
 * position — an empty document resolves to `null` rather than to a fiction.
 */
export const nearestSection = (
  sections: ReadonlyArray<DocumentSection>,
  blockId: BlockId | null,
  /** Section order at the time the location was captured, if known. */
  fallbackIndex: number | null = null,
): DocumentSection | null => {
  if (sections.length === 0) return null;
  if (blockId !== null) {
    const exact = sectionForBlock(sections, blockId);
    if (exact !== null) return exact;
  }
  if (fallbackIndex !== null) {
    const clamped = Math.min(Math.max(fallbackIndex, 0), sections.length - 1);
    return sections[clamped] ?? sections[0] ?? null;
  }
  return sections[0] ?? null;
};

/** A short, speakable description of where somebody is. */
export const describeLocation = (section: DocumentSection | null): string =>
  section === null ? "in this document" : `in ${section.title}`;
