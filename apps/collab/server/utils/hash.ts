import { createHash } from "node:crypto";

/**
 * SHA-256 hex digest of JSON.stringify(payload).
 *
 * This is not canonical JSON (key order is not normalized). Callers such as
 * `appendEventBatch` MUST pass already-normalized parser output (e.g.
 * `parseRichTextEventBatch`) so semantically equivalent batches hash equally.
 */
export const hashPayload = (payload: unknown): string =>
  createHash("sha256").update(JSON.stringify(payload)).digest("hex");
