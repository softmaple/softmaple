import { OPERATION_TYPE } from "../../constants/operation-types";
import type { EventId } from "../../types";
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
): PackedDecodeResult => {
  const count = columns.ids.length;
  if (
    columns.operationIndexes.length !== count ||
    columns.operationLengths.length !== count ||
    columns.timestamps.length !== count
  ) {
    throw new Error("Invalid packed event graph: column length mismatch");
  }

  const offsetById = indexIds(columns.ids);
  const operationColumns = buildOperationColumns(columns, count);
  const {
    parentStarts,
    parentOffsets,
    childStarts,
    childOffsets,
    frontier,
    implicitLinearEdges,
  } = buildEdges(columns.ids, offsetById, columns.parentOverrides);

  return {
    base: new PackedEventGraphBase({
      ids: columns.ids,
      offsetById,
      operationTypes: operationColumns.operationTypes,
      operationIndexes: operationColumns.operationIndexes,
      operationLengths: operationColumns.operationLengths,
      timestamps: operationColumns.timestamps,
      insertStarts: operationColumns.insertStarts,
      insertedContent: columns.insertedContent,
      parentStarts,
      parentOffsets,
      childStarts,
      childOffsets,
      implicitLinearEdges,
    }),
    frontier,
  };
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
    base: new PackedEventGraphBase({
      idIndex: columns.idIndex,
      operationTypes: operationColumns.operationTypes,
      operationIndexes: operationColumns.operationIndexes,
      operationLengths: operationColumns.operationLengths,
      timestamps: operationColumns.timestamps,
      insertStarts: operationColumns.insertStarts,
      insertedContent: columns.insertedContent,
      parentStarts: new Uint32Array(),
      parentOffsets: new Uint32Array(),
      childStarts: new Uint32Array(),
      childOffsets: new Uint32Array(),
      implicitLinearEdges: true,
    }),
    frontier,
  };
};

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

const buildEdges = (
  ids: ReadonlyArray<EventId>,
  offsetById: ReadonlyMap<EventId, number>,
  overrides: ReadonlyArray<ParentOverride>,
): {
  readonly parentStarts: Uint32Array;
  readonly parentOffsets: Uint32Array;
  readonly childStarts: Uint32Array;
  readonly childOffsets: Uint32Array;
  readonly frontier: ReadonlySet<EventId>;
  readonly implicitLinearEdges: boolean;
} => {
  const count = ids.length;
  if (overrides.length === 0) {
    return {
      parentStarts: new Uint32Array(),
      parentOffsets: new Uint32Array(),
      childStarts: new Uint32Array(),
      childOffsets: new Uint32Array(),
      frontier: count === 0 ? new Set() : new Set([ids[count - 1]!]),
      implicitLinearEdges: true,
    };
  }
  validateOverrideOffsets(overrides, count);
  const parentStarts = new Uint32Array(count + 1);
  const childCounts = new Uint32Array(count);
  let edgeCount = 0;
  let overrideCursor = 0;

  for (let eventOffset = 0; eventOffset < count; eventOffset++) {
    const override = overrides[overrideCursor];
    if (override?.eventOffset === eventOffset) {
      validateParents(override.parents, eventOffset, offsetById);
      edgeCount += override.parents.length;
      for (const parent of override.parents) {
        const parentOffset = offsetById.get(parent)!;
        childCounts[parentOffset] = childCounts[parentOffset]! + 1;
      }
      overrideCursor++;
    } else if (eventOffset > 0) {
      edgeCount++;
      childCounts[eventOffset - 1] = childCounts[eventOffset - 1]! + 1;
    }
    if (edgeCount > 0xffffffff) {
      throw new Error("Packed event graph contains too many edges");
    }
    parentStarts[eventOffset + 1] = edgeCount;
  }

  const parentOffsets = new Uint32Array(edgeCount);
  overrideCursor = 0;
  let parentCursor = 0;
  for (let eventOffset = 0; eventOffset < count; eventOffset++) {
    const override = overrides[overrideCursor];
    if (override?.eventOffset === eventOffset) {
      for (const parent of override.parents) {
        parentOffsets[parentCursor++] = offsetById.get(parent)!;
      }
      overrideCursor++;
    } else if (eventOffset > 0) {
      parentOffsets[parentCursor++] = eventOffset - 1;
    }
  }

  const childStarts = new Uint32Array(count + 1);
  for (let offset = 0; offset < count; offset++) {
    childStarts[offset + 1] = childStarts[offset]! + childCounts[offset]!;
  }
  const childOffsets = new Uint32Array(edgeCount);
  const childCursors = childStarts.slice(0, count);
  for (let childOffset = 0; childOffset < count; childOffset++) {
    const start = parentStarts[childOffset]!;
    const end = parentStarts[childOffset + 1]!;
    for (let cursor = start; cursor < end; cursor++) {
      const parentOffset = parentOffsets[cursor]!;
      const childCursor = childCursors[parentOffset]!;
      childOffsets[childCursor] = childOffset;
      childCursors[parentOffset] = childCursor + 1;
    }
  }

  const frontier = new Set<EventId>();
  for (let offset = 0; offset < count; offset++) {
    if (childCounts[offset] === 0) frontier.add(ids[offset]!);
  }
  return {
    parentStarts,
    parentOffsets,
    childStarts,
    childOffsets,
    frontier,
    implicitLinearEdges: false,
  };
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

const validateParents = (
  parents: ReadonlyArray<EventId>,
  childOffset: number,
  offsetById: ReadonlyMap<EventId, number>,
): void => {
  const seen = parents.length > 1 ? new Set<EventId>() : null;
  for (const parent of parents as ReadonlyArray<unknown>) {
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
    const parentOffset = offsetById.get(parent);
    if (parentOffset === undefined) {
      throw new Error(`Missing parent event: ${parent}`);
    }
    if (parentOffset >= childOffset) {
      throw new Error(
        `Parent ${parent} is not before child ${idsForError(childOffset)}`,
      );
    }
  }
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
