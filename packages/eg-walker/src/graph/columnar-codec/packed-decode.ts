import { OPERATION_TYPE } from "../../constants/operation-types";
import type { EventId } from "../../types";
import { GraphRuns } from "../internals/graph-runs";
import {
  PACKED_OPERATION_TYPE,
  PackedEventGraphBase,
  type PackedEventIdIndex,
} from "../internals/packed-event-graph-base";
import {
  compactIntegerColumn,
  compactUnsignedIntegerColumn,
  type PackedIntegerColumn,
  type PackedUnsignedIntegerColumn,
} from "../internals/packed-numeric-columns";
import type { ParentOverride, PartialOperationRun } from "./types";

interface PackedOperationColumns {
  readonly operationRuns: ReadonlyArray<PartialOperationRun>;
  readonly operationIndexes: PackedUnsignedIntegerColumn;
  readonly operationLengths: PackedUnsignedIntegerColumn;
  readonly insertedContent: string;
  readonly timestamps: PackedIntegerColumn;
}

interface PackedDecodeColumns extends PackedOperationColumns {
  readonly ids: ReadonlyArray<EventId>;
  readonly idIndex?: PackedEventIdIndex;
  readonly parentOverrides: ReadonlyArray<ParentOverride>;
}

interface PackedRunIndexedDecodeColumns extends PackedOperationColumns {
  readonly idIndex: PackedEventIdIndex;
  readonly parentOverrides: ReadonlyArray<ParentOverride>;
}

interface PackedLinearDecodeColumns extends PackedOperationColumns {
  readonly idIndex: PackedEventIdIndex;
}

export interface PackedDecodeResult {
  readonly base: PackedEventGraphBase;
  readonly frontier: ReadonlySet<EventId>;
}

export const buildPackedEventGraphBase = (
  columns: PackedDecodeColumns,
): PackedDecodeResult => buildPackedEventGraphBaseInternal(columns);

/**
 * Decode a graph whose IDs stay in the validated ID-run index. No per-event
 * ID string is materialized; parent lookups remain strict.
 */
export const buildPackedEventGraphBaseFromIdRunIndex = (
  columns: PackedRunIndexedDecodeColumns,
): PackedDecodeResult => buildPackedEventGraphBaseInternal(columns);

const buildPackedEventGraphBaseInternal = (
  columns: PackedDecodeColumns | PackedRunIndexedDecodeColumns,
): PackedDecodeResult => {
  const ids = "ids" in columns ? columns.ids : undefined;
  const count = ids?.length ?? columns.idIndex!.count;
  if (
    columns.operationIndexes.length !== count ||
    columns.operationLengths.length !== count ||
    columns.timestamps.length !== count
  ) {
    throw new Error("Invalid packed event graph: column length mismatch");
  }

  const offsetById = columns.idIndex === undefined ? indexIds(ids!) : undefined;
  const idLookup: PackedEventOffsetLookup = columns.idIndex ?? {
    offsetOf: (id) => offsetById!.get(id),
  };
  const idAt =
    ids === undefined
      ? (offset: number): EventId => columns.idIndex!.idAt(offset)!
      : (offset: number): EventId => ids[offset]!;
  const operationColumns = buildOperationColumns(columns, count);
  const { runs, frontier } = buildRuns(
    count,
    idAt,
    idLookup,
    columns.parentOverrides,
  );

  const commonColumns = {
    operationTypes: operationColumns.operationTypes,
    operationIndexes: operationColumns.operationIndexes,
    operationLengths: operationColumns.operationLengths,
    timestamps: operationColumns.timestamps,
    insertStarts: operationColumns.insertStarts,
    insertedContent: columns.insertedContent,
    runs,
  };
  const base =
    columns.idIndex === undefined
      ? PackedEventGraphBase.create({
          ids: ids!,
          offsetById: offsetById!,
          ...commonColumns,
        })
      : ids === undefined
        ? PackedEventGraphBase.create({
            idIndex: columns.idIndex,
            ...commonColumns,
          })
        : PackedEventGraphBase.create({
            ids,
            idIndex: columns.idIndex,
            ...commonColumns,
          });

  return {
    base,
    frontier,
  };
};

interface PackedEventOffsetLookup {
  offsetOf(id: EventId): number | undefined;
}

const indexIds = (ids: ReadonlyArray<EventId>): Map<EventId, number> => {
  const result = new Map<EventId, number>();
  for (let offset = 0; offset < ids.length; offset++) {
    const id = ids[offset];
    if (typeof id !== "string" || id.length === 0) {
      throw new Error(`Invalid event ID at offset ${offset}`);
    }
    if (result.has(id)) {
      throw new Error(`Duplicate event ID in columnar graph: ${id}`);
    }
    result.set(id, offset);
  }
  return result;
};

/** Build an exact-linear packed base without materializing its ID runs. */
export const buildPackedLinearEventGraphBaseFromIdIndex = (
  columns: PackedLinearDecodeColumns,
): PackedDecodeResult => {
  const count = columns.idIndex.count;
  if (
    columns.operationIndexes.length !== count ||
    columns.operationLengths.length !== count ||
    columns.timestamps.length !== count
  ) {
    throw new Error("Invalid packed event graph: column length mismatch");
  }
  const operationColumns = buildOperationColumns(columns, count);
  const frontier = new Set<EventId>();
  if (count > 0) {
    const lastId = columns.idIndex.idAt(count - 1);
    if (lastId === undefined) {
      throw new Error("Invalid packed event graph: missing final event ID");
    }
    frontier.add(lastId);
  }

  return {
    base: PackedEventGraphBase.create({
      idIndex: columns.idIndex,
      operationTypes: operationColumns.operationTypes,
      operationIndexes: operationColumns.operationIndexes,
      operationLengths: operationColumns.operationLengths,
      timestamps: operationColumns.timestamps,
      insertStarts: operationColumns.insertStarts,
      insertedContent: columns.insertedContent,
      runs: GraphRuns.linear(count),
    }),
    frontier,
  };
};

const buildOperationColumns = (
  columns: PackedOperationColumns,
  count: number,
): {
  readonly operationTypes: Uint8Array;
  readonly operationIndexes: PackedUnsignedIntegerColumn;
  readonly operationLengths: PackedUnsignedIntegerColumn;
  readonly timestamps: PackedIntegerColumn;
  readonly insertStarts: Uint32Array;
} => {
  const operationTypes = new Uint8Array(count);
  const insertStarts = new Uint32Array(count);
  let covered = 0;
  let contentOffset = 0;

  for (const [runIndex, run] of columns.operationRuns.entries()) {
    if (run.length <= 0 || !Number.isSafeInteger(run.length)) {
      throw new Error(
        `Operation run ${runIndex} must have positive safe length`,
      );
    }
    if (run.startEventOffset !== covered || covered + run.length > count) {
      throw new Error(
        `Operation run ${runIndex} does not exactly cover its events`,
      );
    }

    const marker =
      run.type === OPERATION_TYPE.INSERT
        ? PACKED_OPERATION_TYPE.INSERT
        : PACKED_OPERATION_TYPE.DELETE;
    for (let offset = covered; offset < covered + run.length; offset++) {
      const index = columns.operationIndexes[offset]!;
      const length = columns.operationLengths[offset]!;
      if (!Number.isSafeInteger(index) || index < 0) {
        throw new Error(`Invalid operation index at event offset ${offset}`);
      }
      if (!Number.isSafeInteger(length) || length < 0) {
        throw new Error(`Invalid operation length at event offset ${offset}`);
      }
      if (!Number.isSafeInteger(columns.timestamps[offset])) {
        throw new Error(`Invalid timestamp at event offset ${offset}`);
      }

      operationTypes[offset] = marker;
      if (marker === PACKED_OPERATION_TYPE.INSERT) {
        if (contentOffset > 0xffffffff) {
          throw new Error(
            "Inserted content exceeds packed UTF-16 offset range",
          );
        }
        insertStarts[offset] = contentOffset;
        const end = contentOffset + length;
        if (
          !Number.isSafeInteger(end) ||
          end > columns.insertedContent.length
        ) {
          throw new Error(
            `Insert text exceeds content column at event offset ${offset}`,
          );
        }
        assertWellFormedUtf16Range(
          columns.insertedContent,
          contentOffset,
          end,
          offset,
        );
        contentOffset = end;
      }
    }
    covered += run.length;
  }

  if (covered !== count) {
    throw new Error(
      `Operation runs cover ${covered} events but graph contains ${count}`,
    );
  }
  if (contentOffset !== columns.insertedContent.length) {
    throw new Error(
      `Inserted-content size mismatch (expected ${contentOffset}, got ${columns.insertedContent.length})`,
    );
  }
  return {
    operationTypes,
    operationIndexes: compactUnsignedIntegerColumn(columns.operationIndexes),
    operationLengths: compactUnsignedIntegerColumn(columns.operationLengths),
    timestamps: compactIntegerColumn(columns.timestamps),
    insertStarts,
  };
};

/**
 * Build the graph's runs from its parent overrides. Every event without an
 * override has the previous event as its only parent, so the work follows
 * the overrides rather than the event count, and no per-event edge column is
 * allocated.
 */
const buildRuns = (
  count: number,
  idAt: (offset: number) => EventId,
  idIndex: PackedEventOffsetLookup,
  overrides: ReadonlyArray<ParentOverride>,
): { readonly runs: GraphRuns; readonly frontier: ReadonlySet<EventId> } => {
  if (overrides.length === 0) {
    return {
      runs: GraphRuns.linear(count),
      frontier: count === 0 ? new Set() : new Set([idAt(count - 1)]),
    };
  }
  validateOverrideOffsets(overrides, count);
  countPackedEdges(count, overrides);
  const explicit = new Uint32Array(overrides.length);
  const parentStarts = new Uint32Array(overrides.length + 1);
  const parents: number[] = [];
  for (const [index, override] of overrides.entries()) {
    const eventOffset = override.eventOffset;
    const seen = override.parents.length > 1 ? new Set<EventId>() : undefined;
    for (const parent of override.parents as ReadonlyArray<unknown>) {
      parents.push(resolveParentOffset(parent, eventOffset, idIndex, seen));
    }
    explicit[index] = eventOffset;
    parentStarts[index + 1] = parents.length;
  }
  const runs = GraphRuns.fromExplicitParents(
    count,
    explicit,
    parentStarts,
    parents,
  );

  // Only the last event of a run can lack a child.
  const frontier = new Set<EventId>();
  for (let run = 0; run < runs.count; run++) {
    if (runs.childCountOf(run) === 0) {
      frontier.add(idAt(runs.lastOf(run)));
    }
  }
  return { runs, frontier };
};

const countPackedEdges = (
  eventCount: number,
  overrides: ReadonlyArray<ParentOverride>,
): number => {
  let edgeCount = Math.max(0, eventCount - 1);
  for (const override of overrides) {
    // An override replaces the implicit edge from the immediately preceding
    // event (except at offset zero, where there is no implicit edge).
    edgeCount += override.parents.length - (override.eventOffset > 0 ? 1 : 0);
    if (!Number.isSafeInteger(edgeCount) || edgeCount > 0xffffffff) {
      throw new Error("Packed event graph contains too many edges");
    }
  }
  return edgeCount;
};

const validateOverrideOffsets = (
  overrides: ReadonlyArray<ParentOverride>,
  eventCount: number,
): void => {
  let previous = -1;
  for (const override of overrides) {
    if (
      !Number.isSafeInteger(override.eventOffset) ||
      override.eventOffset <= previous ||
      override.eventOffset < 0 ||
      override.eventOffset >= eventCount
    ) {
      throw new Error(`Invalid parent override offset ${override.eventOffset}`);
    }
    previous = override.eventOffset;
  }
};

const resolveParentOffset = (
  parent: unknown,
  childOffset: number,
  idIndex: PackedEventOffsetLookup,
  seen: Set<EventId> | undefined,
): number => {
  if (typeof parent !== "string" || parent.length === 0) {
    throw new Error(
      `Event at offset ${childOffset} contains a non-string parent`,
    );
  }
  if (seen?.has(parent)) {
    throw new Error(
      `Event at offset ${childOffset} contains duplicate parent ${parent}`,
    );
  }
  seen?.add(parent);
  const parentOffset = idIndex.offsetOf(parent);
  if (parentOffset === undefined) {
    throw new Error(`Missing parent event: ${parent}`);
  }
  if (parentOffset >= childOffset) {
    throw new Error(
      `Parent ${parent} is not before child ${idsForError(childOffset)}`,
    );
  }
  return parentOffset;
};

const idsForError = (offset: number): string => `at offset ${offset}`;

const assertWellFormedUtf16Range = (
  text: string,
  start: number,
  end: number,
  eventOffset: number,
): void => {
  for (let cursor = start; cursor < end; cursor++) {
    const code = text.charCodeAt(cursor);
    if (code >= 0xd800 && code <= 0xdbff) {
      const low = cursor + 1 < end ? text.charCodeAt(cursor + 1) : -1;
      if (low < 0xdc00 || low > 0xdfff) {
        throw new Error(
          `Insert text at event offset ${eventOffset} is not well-formed UTF-16`,
        );
      }
      cursor++;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new Error(
        `Insert text at event offset ${eventOffset} is not well-formed UTF-16`,
      );
    }
  }
};
