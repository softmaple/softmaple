/**
 * Keyset pagination for the workspace document list.
 *
 * Offset pagination is wrong here: documents are ordered by when they were
 * last touched, and that changes while somebody is paging. An offset would
 * skip or repeat a document the moment a collaborator saved. A keyset cursor
 * names the last row seen, so the next page continues from a fixed point
 * whatever else moves.
 *
 * The order is `updated_at DESC NULLS LAST, id DESC`, which matches
 * `documents_workspace_updated_cursor_idx`.
 */

export type DocumentPageCursor = {
  /** `null` for a document that has never been updated. */
  readonly updatedAt: string | null;
  readonly id: string;
};

const SEPARATOR = "|";
/** Stands in for a null `updated_at`, which sorts last. */
const NULL_MARKER = "~";

/** Encode a cursor for a URL or a client round trip. */
export const encodeDocumentPageCursor = (cursor: DocumentPageCursor): string =>
  `${cursor.updatedAt === null ? NULL_MARKER : cursor.updatedAt}${SEPARATOR}${cursor.id}`;

/**
 * Decode a cursor. Returns `null` for anything malformed rather than throwing:
 * a bad cursor in a URL should show the first page, not an error page.
 */
export const decodeDocumentPageCursor = (
  raw: string | null | undefined,
): DocumentPageCursor | null => {
  if (raw === null || raw === undefined) return null;
  const separatorIndex = raw.indexOf(SEPARATOR);
  if (separatorIndex <= 0) return null;
  const updatedAt = raw.slice(0, separatorIndex);
  const id = raw.slice(separatorIndex + 1);
  if (id.length === 0) return null;
  if (updatedAt === NULL_MARKER) return { updatedAt: null, id };
  return Number.isNaN(Date.parse(updatedAt)) ? null : { updatedAt, id };
};

/**
 * The PostgREST `or` filter that continues after a cursor.
 *
 * Written out rather than generated so the three cases are visible: strictly
 * older, the same timestamp with a smaller id, and the never-updated tail that
 * sorts after everything.
 */
export const documentPageFilter = (cursor: DocumentPageCursor): string =>
  cursor.updatedAt === null
    ? `and(updated_at.is.null,id.lt.${cursor.id})`
    : [
        `updated_at.lt.${cursor.updatedAt}`,
        `and(updated_at.eq.${cursor.updatedAt},id.lt.${cursor.id})`,
        "updated_at.is.null",
      ].join(",");

/** The cursor that continues after a page, or `null` when it is the last. */
export const nextDocumentPageCursor = <
  TRow extends { readonly id: string; readonly updated_at: string | null },
>(
  page: ReadonlyArray<TRow>,
  limit: number,
): DocumentPageCursor | null => {
  if (page.length < limit) return null;
  const last = page[page.length - 1];
  return last === undefined
    ? null
    : { updatedAt: last.updated_at, id: last.id };
};

/**
 * Escape a title filter for PostgREST `ilike`.
 *
 * `%` and `_` are wildcards and a comma ends a filter clause, so a title
 * containing one would otherwise change the query's meaning rather than being
 * searched for.
 */
export const escapeTitleFilter = (query: string): string =>
  query
    .trim()
    .replaceAll("\\", "\\\\")
    .replaceAll("%", "\\%")
    .replaceAll("_", "\\_")
    .replaceAll(",", "\\,")
    .replaceAll("(", "\\(")
    .replaceAll(")", "\\)");
