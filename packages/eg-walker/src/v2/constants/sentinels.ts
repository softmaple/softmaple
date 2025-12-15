/**
 * CRDT sentinel constants for boundary markers.
 * These special IDs mark the start and end of the CRDT sequence.
 */

/**
 * CRDT boundary sentinel values used to mark the logical start and end of ordered sequences.
 * 
 * These sentinels serve as immutable boundary markers in the CRDT data structure,
 * enabling consistent ordering and iteration without special-case logic for empty lists.
 * They are never deleted and always maintain their positions at the sequence boundaries.
 * 
 * - `START_ID`: Represents the beginning boundary - all real items come after this
 * - `END_ID`: Represents the ending boundary - all real items come before this
 * 
 * @example
 * ```typescript
 * // Check if an ID is a sentinel
 * if (id === CRDT_SENTINELS.START_ID || id === CRDT_SENTINELS.END_ID) {
 *   // Skip sentinels during iteration
 *   continue;
 * }
 * 
 * // Initialize a new sequence with sentinels
 * const items = [
 *   { id: CRDT_SENTINELS.START_ID, next: firstItemId },
 *   { id: firstItemId, prev: CRDT_SENTINELS.START_ID, next: CRDT_SENTINELS.END_ID },
 *   { id: CRDT_SENTINELS.END_ID, prev: firstItemId }
 * ];
 * ```
 * 
 * @public
 */
export const CRDT_SENTINELS = {
  START_ID: "__START__",
  END_ID: "__END__",
} as const;

/**
 * Union type representing valid CRDT sentinel identifiers.
 * 
 * Use this type when accepting or returning sentinel values to ensure type safety.
 * This type evaluates to `"__START__" | "__END__"` and is typically used in 
 * function signatures that need to handle or validate sentinel boundaries.
 * 
 * @example
 * ```typescript
 * function isSentinel(id: string): id is SentinelId {
 *   return id === CRDT_SENTINELS.START_ID || id === CRDT_SENTINELS.END_ID;
 * }
 * ```
 * 
 * @public
 */
export type SentinelId = (typeof CRDT_SENTINELS)[keyof typeof CRDT_SENTINELS];
