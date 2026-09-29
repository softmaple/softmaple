export interface TextChange {
  readonly from: number;
  readonly oldTo: number;
  readonly insert: string;
}

/**
 * Smallest single splice turning `before` into `after`, on code point
 * boundaries. Scans UTF-16 code units so a keystroke in a long block does not
 * allocate one string per code point.
 */
export const diffText = (before: string, after: string): TextChange | null => {
  if (before === after) {
    return null;
  }
  const shorter = Math.min(before.length, after.length);
  let prefix = 0;
  while (
    prefix < shorter &&
    before.charCodeAt(prefix) === after.charCodeAt(prefix)
  ) {
    prefix++;
  }
  if (splitsSurrogatePair(before, prefix)) {
    prefix--;
  }
  let suffix = 0;
  while (
    suffix < shorter - prefix &&
    before.charCodeAt(before.length - suffix - 1) ===
      after.charCodeAt(after.length - suffix - 1)
  ) {
    suffix++;
  }
  if (splitsSurrogatePair(before, before.length - suffix)) {
    suffix--;
  }
  return {
    from: prefix,
    oldTo: before.length - suffix,
    insert: after.slice(prefix, after.length - suffix),
  };
};

const splitsSurrogatePair = (text: string, offset: number): boolean => {
  const previous = text.charCodeAt(offset - 1);
  const next = text.charCodeAt(offset);
  return (
    previous >= 0xd800 && previous <= 0xdbff && next >= 0xdc00 && next <= 0xdfff
  );
};
