import type { PackedOperationColumns } from "./packed-event-graph-base";
import { SpanColumn } from "./span-column";

/** Resident columns after a large receive; replay can request dense copies. */
export class SealedOperationColumns {
  readonly types: SpanColumn;
  readonly indexes: SpanColumn;
  readonly lengths: SpanColumn;
  readonly timestamps: SpanColumn;
  readonly insertStarts: SpanColumn;
  private readonly wideIndexes: boolean;
  private readonly wideLengths: boolean;
  private readonly timestampKind: "signed" | "unsigned" | "wide";

  constructor(columns: PackedOperationColumns) {
    this.wideIndexes = columns.operationIndexes instanceof Float64Array;
    this.wideLengths = columns.operationLengths instanceof Float64Array;
    this.timestampKind =
      columns.timestamps instanceof Float64Array
        ? "wide"
        : columns.timestamps instanceof Int32Array
          ? "signed"
          : "unsigned";
    this.types = SpanColumn.from(columns.operationTypes);
    this.indexes = SpanColumn.from(columns.operationIndexes);
    this.lengths = SpanColumn.from(columns.operationLengths);
    this.timestamps = SpanColumn.from(columns.timestamps);
    this.insertStarts = SpanColumn.from(columns.insertStarts);
  }

  materialize(): PackedOperationColumns {
    const count = this.types.length;
    const columns: PackedOperationColumns = {
      operationTypes: new Uint8Array(count),
      operationIndexes: this.wideIndexes
        ? new Float64Array(count)
        : new Uint32Array(count),
      operationLengths: this.wideLengths
        ? new Float64Array(count)
        : new Uint32Array(count),
      timestamps:
        this.timestampKind === "wide"
          ? new Float64Array(count)
          : this.timestampKind === "signed"
            ? new Int32Array(count)
            : new Uint32Array(count),
      insertStarts: new Uint32Array(count),
    };
    this.types.copyTo(columns.operationTypes);
    this.indexes.copyTo(columns.operationIndexes);
    this.lengths.copyTo(columns.operationLengths);
    this.timestamps.copyTo(columns.timestamps);
    this.insertStarts.copyTo(columns.insertStarts);
    return columns;
  }
}
