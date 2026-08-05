export const BLOCK_TYPES = [
  "paragraph",
  "h1",
  "h2",
  "h3",
  "quote",
  "code",
  "bullet-list",
  "number-list",
  "check-list",
] as const;

export const MARK_KINDS = [
  "bold",
  "italic",
  "underline",
  "strike",
  "inline-code",
  "link",
] as const;

export const BLOCK_TYPE_SET: ReadonlySet<string> = new Set(BLOCK_TYPES);
export const MARK_KIND_SET: ReadonlySet<string> = new Set(MARK_KINDS);
