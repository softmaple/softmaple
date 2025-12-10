/**
 * Document manipulation utilities
 * Pure functions for document operations
 */

/**
 * Insert a string at a position immutably
 */
export const insertAt = (
  document: readonly string[],
  position: number,
  content: string,
): string[] => {
  const safePosition = Math.max(0, Math.min(position, document.length));
  return [
    ...document.slice(0, safePosition),
    ...content.split(""),
    ...document.slice(safePosition),
  ];
};

/**
 * Delete at a position immutably
 */
export const deleteAt = (
  document: readonly string[],
  position: number,
): string[] => {
  if (position < 0 || position >= document.length) {
    return [...document];
  }
  return [...document.slice(0, position), ...document.slice(position + 1)];
};

/**
 * Apply multiple insertions immutably
 */
export const applyInsertions = (
  document: readonly string[],
  insertions: Array<{ position: number; content: string }>,
): string[] => {
  // Sort insertions by position in descending order to maintain correct indices
  const sorted = [...insertions].sort((a, b) => b.position - a.position);

  return sorted.reduce(
    (doc, { position, content }) => insertAt(doc, position, content),
    [...document],
  );
};

/**
 * Apply multiple deletions immutably
 */
export const applyDeletions = (
  document: readonly string[],
  positions: readonly number[],
): string[] => {
  // Sort positions in descending order to maintain correct indices
  const sorted = [...positions].sort((a, b) => b - a);

  return sorted.reduce(
    (doc, position) => deleteAt(doc, position),
    [...document],
  );
};

/**
 * Create empty document
 */
export const emptyDocument = (): string[] => [];

/**
 * Convert document array to string
 */
export const documentToString = (document: readonly string[]): string =>
  document.join("");

/**
 * Convert string to document array
 */
export const stringToDocument = (text: string): string[] => text.split("");

/**
 * Get document length
 */
export const documentLength = (document: readonly string[]): number =>
  document.length;

/**
 * Check if document is empty
 */
export const isEmptyDocument = (document: readonly string[]): boolean =>
  document.length === 0;

/**
 * Get character at position safely
 */
export const charAt = (
  document: readonly string[],
  position: number,
): string | undefined => document[position];

/**
 * Replace character at position
 */
export const replaceAt = (
  document: readonly string[],
  position: number,
  char: string,
): string[] => {
  if (position < 0 || position >= document.length) {
    return [...document];
  }
  return [
    ...document.slice(0, position),
    char,
    ...document.slice(position + 1),
  ];
};
