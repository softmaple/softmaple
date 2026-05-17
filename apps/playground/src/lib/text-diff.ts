/**
 * Text diffing utilities for collaborative editing.
 *
 * Implementations live in `@softmaple/awareness/mapping` so they can be
 * shared with other consumers; this module re-exports them to keep existing
 * `@/lib/text-diff` imports working.
 */

export { findChangedSpan } from "@softmaple/awareness/mapping";
