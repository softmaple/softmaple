import { BLOCK_MARKER, METADATA_MARKER, TEXT_ESCAPE } from "./constants";
import { isReserved } from "./wire";

/**
 * Decoded view of the raw sequence between one block marker and the next.
 *
 * Offsets here are content offsets: 0 is the code unit right after the block
 * marker. Metadata markers occupy one raw code unit and no text; an escaped
 * reserved character occupies two raw code units and one text code unit.
 * Both therefore add exactly one raw code unit, so the mapping between raw and
 * logical offsets only needs their sorted positions.
 */
export interface SegmentLayout {
  readonly content: string;
  readonly text: string;
  /** Sorted content offsets of metadata markers and escape prefixes. */
  readonly specials: ReadonlyArray<number>;
}

export interface LayoutBoundary {
  readonly logical: number;
  readonly offset: number;
}

export interface ContentRange {
  readonly start: number;
  readonly end: number;
}

export const EMPTY_LAYOUT: SegmentLayout = Object.freeze({
  content: "",
  text: "",
  specials: Object.freeze([]),
});

const METADATA_CODE = METADATA_MARKER.charCodeAt(0);
const BLOCK_CODE = BLOCK_MARKER.charCodeAt(0);
const ESCAPE_CODE = TEXT_ESCAPE.charCodeAt(0);

/** Decode with the same validation as the full materializer. */
export const decodeLayout = (content: string): SegmentLayout => {
  let text = "";
  const specials: number[] = [];
  let runStart = 0;
  let index = 0;
  while (index < content.length) {
    const code = content.charCodeAt(index);
    if (code === METADATA_CODE) {
      text += content.slice(runStart, index);
      specials.push(index);
      index++;
      runStart = index;
    } else if (code === BLOCK_CODE) {
      throw new Error("Unindexed block marker found inside a block segment");
    } else if (code === ESCAPE_CODE) {
      const escaped = content[index + 1];
      if (escaped === undefined || !isReserved(escaped)) {
        throw new Error("Malformed escaped rich-text payload");
      }
      text += content.slice(runStart, index) + escaped;
      specials.push(index);
      index += 2;
      runStart = index;
    } else {
      index++;
    }
  }
  if (runStart === 0) {
    return { content, text: content, specials };
  }
  text += content.slice(runStart);
  return { content, text, specials };
};

/**
 * Apply a raw edit and update the layout without rescanning the segment when
 * the edit touches only ordinary text. Anything else is decoded again.
 */
export const spliceLayout = (
  layout: SegmentLayout,
  offset: number,
  deleteCount: number,
  inserted: string,
): SegmentLayout => {
  const { content, specials } = layout;
  const next =
    content.slice(0, offset) + inserted + content.slice(offset + deleteCount);
  if (splitsUnit(layout, offset) || splitsUnit(layout, offset + deleteCount)) {
    return decodeLayout(next);
  }
  const first = lowerBound(specials, offset);
  if (deleteCount === 0 && inserted === METADATA_MARKER) {
    const shifted = specials.slice(0, first);
    shifted.push(offset);
    for (let index = first; index < specials.length; index++) {
      shifted.push(specials[index]! + 1);
    }
    return { content: next, text: layout.text, specials: shifted };
  }
  if (!isPlainText(inserted)) {
    return decodeLayout(next);
  }
  if (deleteCount > 0 && lowerBound(specials, offset + deleteCount) !== first) {
    return decodeLayout(next);
  }
  const logical = offset - first;
  const delta = inserted.length - deleteCount;
  const text =
    layout.text.slice(0, logical) +
    inserted +
    layout.text.slice(logical + deleteCount);
  if (delta === 0 || first === specials.length) {
    return { content: next, text, specials };
  }
  const shifted = specials.slice();
  for (let index = first; index < shifted.length; index++) {
    shifted[index]! += delta;
  }
  return { content: next, text, specials: shifted };
};

/** Logical offset at content boundary `offset`. */
export const logicalAt = (layout: SegmentLayout, offset: number): number =>
  offset - lowerBound(layout.specials, offset);

/**
 * Content offset of logical boundary `logical`: immediately after the unit
 * that ends there and before any metadata marker that follows it.
 */
export const contentOffsetOf = (
  layout: SegmentLayout,
  logical: number,
): number => {
  const { specials } = layout;
  let low = 0;
  let high = specials.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (specials[middle]! - middle < logical) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return logical + low;
};

/** Whether `logical` is a text boundary that does not split a code point. */
export const isLogicalBoundary = (
  layout: SegmentLayout,
  logical: number,
): boolean => {
  if (
    !Number.isSafeInteger(logical) ||
    logical < 0 ||
    logical > layout.text.length
  ) {
    return false;
  }
  return !splitsSurrogatePair(layout.content, contentOffsetOf(layout, logical));
};

/** Largest text boundary at or before content offset `offset`. */
export const boundaryAtOrBefore = (
  layout: SegmentLayout,
  offset: number,
): LayoutBoundary => {
  let logical = logicalAt(layout, offset);
  if (!isLogicalBoundary(layout, logical)) {
    logical--;
  }
  return { logical, offset: contentOffsetOf(layout, logical) };
};

/** Smallest text boundary at or after content offset `offset`. */
export const boundaryAtOrAfter = (
  layout: SegmentLayout,
  offset: number,
): LayoutBoundary | null => {
  const before = boundaryAtOrBefore(layout, offset);
  if (before.offset === offset) {
    return before;
  }
  let logical = before.logical + 1;
  if (!isLogicalBoundary(layout, logical)) {
    logical++;
  }
  if (logical > layout.text.length) {
    return null;
  }
  return { logical, offset: contentOffsetOf(layout, logical) };
};

/**
 * Raw ranges holding the text units in logical `[from, to)`. Metadata markers
 * between units split the ranges, exactly like contiguous unit grouping.
 */
export const unitRanges = (
  layout: SegmentLayout,
  from: number,
  to: number,
): ContentRange[] => {
  const end = contentOffsetOf(layout, to);
  let start = contentOffsetOf(layout, from);
  const ranges: ContentRange[] = [];
  const { content, specials } = layout;
  for (
    let index = lowerBound(specials, start);
    index < specials.length && specials[index]! < end;
    index++
  ) {
    const special = specials[index]!;
    if (content.charCodeAt(special) !== METADATA_CODE) {
      continue;
    }
    if (special > start) {
      ranges.push({ start, end: special });
    }
    start = special + 1;
  }
  if (end > start) {
    ranges.push({ start, end });
  }
  return ranges;
};

/** Whether content offset `offset` falls strictly inside one text unit. */
export const splitsUnit = (layout: SegmentLayout, offset: number): boolean =>
  (offset > 0 &&
    layout.content.charCodeAt(offset - 1) === ESCAPE_CODE &&
    isSpecialAt(layout.specials, offset - 1)) ||
  splitsSurrogatePair(layout.content, offset);

const isSpecialAt = (specials: ReadonlyArray<number>, offset: number) => {
  const index = lowerBound(specials, offset);
  return index < specials.length && specials[index] === offset;
};

const splitsSurrogatePair = (content: string, offset: number): boolean =>
  offset > 0 &&
  offset < content.length &&
  isHighSurrogate(content.charCodeAt(offset - 1)) &&
  isLowSurrogate(content.charCodeAt(offset));

const isPlainText = (text: string): boolean => {
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code === METADATA_CODE || code === BLOCK_CODE || code === ESCAPE_CODE) {
      return false;
    }
  }
  return (
    text.length === 0 ||
    (!isLowSurrogate(text.charCodeAt(0)) &&
      !isHighSurrogate(text.charCodeAt(text.length - 1)))
  );
};

const isHighSurrogate = (code: number): boolean =>
  code >= 0xd800 && code <= 0xdbff;

const isLowSurrogate = (code: number): boolean =>
  code >= 0xdc00 && code <= 0xdfff;

/** First index whose value is `>= value`. */
const lowerBound = (values: ReadonlyArray<number>, value: number): number => {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (values[middle]! < value) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low;
};
