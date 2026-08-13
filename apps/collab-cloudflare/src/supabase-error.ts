/**
 * PostgREST failures reach us as data, not as exceptions.
 *
 * `@supabase/postgrest-js` only constructs a `PostgrestError` (which does
 * extend `Error`) on its `shouldThrowOnError` path. The `{ data, error }`
 * result this codebase uses carries a **plain object literal**
 * (`{ code, details, hint, message }`), so re-throwing it verbatim produces a
 * non-`Error` throw: every downstream `error instanceof Error` check fails,
 * the name degrades to `"UnknownError"`, and `String(error)` renders the
 * whole diagnosis as `"[object Object]"`.
 *
 * Wrap the result here instead, so the query that failed and PostgREST's own
 * code/details/hint survive into the log.
 */

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const field = (source: Record<string, unknown>, key: string): string | null => {
  const value = source[key];
  return typeof value === "string" && value.length > 0 ? value : null;
};

/** `code`/`details`/`hint` are all nullable in a PostgREST error body. */
const describe = (error: unknown): string => {
  if (!isRecord(error)) return String(error);
  const parts = [
    field(error, "code"),
    field(error, "message"),
    field(error, "details"),
    field(error, "hint"),
  ].filter((part): part is string => part !== null);
  return parts.length === 0 ? JSON.stringify(error) : parts.join(" | ");
};

/**
 * Converts a PostgREST `{ data, error }` failure into a real `Error` naming
 * the `operation` that produced it. An `Error` that somehow arrives here is
 * returned unchanged so a genuine exception keeps its stack.
 */
export const supabaseQueryError = (
  operation: string,
  error: unknown,
): Error => {
  if (error instanceof Error) return error;
  const wrapped = new Error(`${operation} failed: ${describe(error)}`);
  wrapped.name = "SupabaseQueryError";
  return wrapped;
};
