/**
 * Editor-agnostic position operation shape returned alongside
 * structural results from {@link EgWalkerReplica.applyRemoteEvent}.
 *
 * This mirrors the `PositionOperation` shape that
 * `@softmaple/awareness/mapping` defines for selection mapping, but the
 * type is owned by eg-walker so the package does not need to depend on
 * `@softmaple/awareness` (see `docs/design/collaboration-layers.md`).
 * Consumers that need to drive awareness mapping from a remote event can
 * pass the returned operation straight through; structural typing makes
 * the shapes interchangeable at the consumer boundary.
 *
 * The `length` is measured in the replica's index unit — UTF-16 code
 * units. Inserts report the inserted span, deletes the removed span.
 */
export type InsertPositionOperation = {
  readonly type: "insert";
  readonly index: number;
  readonly length: number;
};

export type DeletePositionOperation = {
  readonly type: "delete";
  readonly index: number;
  readonly length: number;
};

export type PositionOperation =
  | InsertPositionOperation
  | DeletePositionOperation;
