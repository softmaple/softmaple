import { createHash } from "node:crypto";

/** SHA-256 hex digest of canonical JSON (stable key order via JSON.stringify). */
export const hashPayload = (payload: unknown): string =>
  createHash("sha256").update(JSON.stringify(payload)).digest("hex");
