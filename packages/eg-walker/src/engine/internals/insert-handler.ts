import { OPERATION_TYPE } from "../../constants/operation-types";
import { parseEventId } from "../../graph/event-id";
import type { EventId, ExternalOperation, GraphEvent } from "../../types";
import type { IndexedSequence } from "../indexed-sequence";
import type { AugmentedCRDTItem, TypedRun } from "./engine-types";
import { EventItemIndex } from "./event-item-index";
import { OriginLeftIndex } from "./origin-left-index";
import { PendingInsertBuffer } from "./pending-insert-buffer";
import { RecordSplitter } from "./record-splitter";
import { stringCodeUnits } from "./text-utils";
import { FugueOrderIndex } from "./fugue-order-index";
import { findIntegrationPosition } from "./yata-integration";

type InsertOperation = Extract<
  ExternalOperation,
  { type: typeof OPERATION_TYPE.INSERT }
>;

const NO_TRANSFORMED_OPERATIONS: ReadonlyArray<ExternalOperation> =
  Object.freeze([]);

export interface InsertHandlerDeps {
  readonly sequence: IndexedSequence<AugmentedCRDTItem>;
  readonly itemsById: Map<EventId, AugmentedCRDTItem>;
  readonly eventItems: EventItemIndex;
  readonly originLeftIndex: OriginLeftIndex;
  readonly recordSplitter: RecordSplitter;
  readonly fugueOrder: FugueOrderIndex;
  readonly pendingInsert: PendingInsertBuffer;
  readonly applyPendingSplice: (effectIndex: number, text: string) => void;
  readonly flushPendingInsert: () => void;
  readonly itemToEffectIndex: (target: AugmentedCRDTItem) => number;
  readonly requireItem: (itemId: EventId) => AugmentedCRDTItem;
  readonly insertText: (index: number, text: string) => void;
  readonly recordIntegrationProbe: () => void;
  readonly useLinearIntegrationOracle: () => boolean;
}

export const applyInsert = (
  event: GraphEvent,
  operation: InsertOperation,
  deps: InsertHandlerDeps,
  collectTransformedOperations: boolean,
): ReadonlyArray<ExternalOperation> => {
  const {
    sequence,
    itemsById,
    eventItems,
    originLeftIndex,
    recordSplitter,
    fugueOrder,
    pendingInsert,
    applyPendingSplice,
    flushPendingInsert,
    itemToEffectIndex,
    requireItem,
    insertText,
    recordIntegrationProbe,
    useLinearIntegrationOracle,
  } = deps;

  if (operation.text.length === 0) {
    eventItems.set(event.id, []);
    return NO_TRANSFORMED_OPERATIONS;
  }

  const landing = sequence.prepareIndexToPositionAndOffset(
    operation.index,
    true,
  );
  const firstInsertPosition =
    landing.offsetInRecord > 0
      ? recordSplitter.splitRecordAt(landing.position, landing.offsetInRecord)
      : landing.position;
  // YATA-style origins are derived from the event's parent (prepare) version,
  // NOT from whichever concurrent records happen to be sitting in the
  // sequence right now. Without this filter the engine would assign different
  // origins to the same event depending on which concurrent siblings were
  // integrated first, breaking traversal-order independence.
  const originLeftPosition =
    sequence.previousPrepareVisiblePosition(firstInsertPosition);
  const originLeft =
    originLeftPosition === null
      ? null
      : (sequence.at(originLeftPosition)?.id ?? null);
  // The paper artifact's YjsMod/Fugue right-origin search starts at the first
  // record that exists in the prepare version, including a record deleted in
  // that version. A deleted record has zero prepare *width* but is still an
  // ordering anchor. Using the next prepare-visible record here skips such
  // anchors and makes the origin tuple depend on which valid topological order
  // happened to build the sequence.
  const anchorSearchStart = (originLeftPosition ?? -1) + 1;
  let originRightPosition: number | null = null;
  const candidatePosition =
    sequence.nextPrepareAnchorPosition(anchorSearchStart);
  const candidate =
    candidatePosition === null ? undefined : sequence.at(candidatePosition);
  originRightPosition =
    candidate !== undefined && candidate.originLeft === originLeft
      ? candidatePosition
      : null;
  const originRight =
    originRightPosition === null
      ? null
      : (sequence.at(originRightPosition)?.id ?? null);

  // Section 3.4 internal-document fast path for the first item.
  //
  // The YATA integration scan walks the sequence positions strictly between
  // `originLeft` and `originRight`. When that range is empty (no retreated,
  // deleted, or otherwise non-prepare-visible records sit in it) the scan
  // is provably a no-op, so we can place the first item at
  // `firstInsertPosition` without invoking it. The dominant case for this
  // is a non-conflicting run: no concurrent siblings have been integrated
  // near the insertion point, so the previous-prepare-visible record is
  // the literal neighbour of `firstInsertPosition`.
  const leftBound = originLeftPosition ?? -1;
  const rightBound = originRightPosition ?? sequence.length;
  const conflictRegionEmpty =
    leftBound + 1 === firstInsertPosition && firstInsertPosition === rightBound;

  // Section 3.4 "smaller" lever: typed-run coalescing.
  //
  // When a single-character INSERT lands at the right boundary of an
  // adjacent typed-run record from the same author whose run extends by
  // exactly one sequence number, append to that record's content instead
  // of allocating a new CRDT item. The columnar codec already groups
  // events into id-runs by (replicaId, contiguous sequence) for wire
  // encoding; mirroring that grouping in the ranked B-tree collapses a
  // 20k-character linear single-author trace to ~1 record (down from one
  // per code unit) while leaving multi-author / multi-event ordering
  // unchanged — split-on-demand carves the run when a concurrent insert
  // or delete anchors inside it.
  const parsed = parseEventId(event.id);
  if (
    conflictRegionEmpty &&
    operation.text.length === 1 &&
    parsed !== null &&
    originLeftPosition !== null &&
    originLeftPosition === firstInsertPosition - 1
  ) {
    const leftRecord = sequence.at(originLeftPosition);
    if (
      leftRecord !== undefined &&
      leftRecord.run !== null &&
      leftRecord.run.replicaId === parsed.replicaId &&
      leftRecord.run.startSequence + leftRecord.content.length ===
        parsed.sequence &&
      leftRecord.prepareState === 1 &&
      !leftRecord.everDeleted &&
      // Don't extend a run that already has items anchored to its right
      // boundary — those items chose this id as their `originLeft` at a
      // moment when the record ended one code unit earlier, and stretching
      // the content would shift the boundary they were anchored to.
      !originLeftIndex.has(leftRecord.id)
    ) {
      if (typeof leftRecord.content !== "string") {
        throw new Error("Typed-run content must be materialized text");
      }
      const effectIndex =
        itemToEffectIndex(leftRecord) + leftRecord.content.length;
      leftRecord.content += operation.text;
      sequence.updateItem(leftRecord);
      eventItems.set(event.id, [leftRecord.id]);
      // Defer the splice on the engine's resulting text into the
      // pending-insert buffer so a long single-author typed run doesn't
      // pay an O(document length) string realloc per keystroke.
      // {@link flushPendingInsert} materialises the buffer before any
      // non-coalesced read or write of the document text.
      pendingInsert.append(effectIndex, operation.text, applyPendingSplice);

      return collectTransformedOperations
        ? [
            {
              type: OPERATION_TYPE.INSERT,
              index: effectIndex,
              text: operation.text,
            },
          ]
        : NO_TRANSFORMED_OPERATIONS;
    }
  }

  const codeUnits = stringCodeUnits(operation.text);
  const insertedIds: EventId[] = [];
  let left = originLeft;

  // First code unit: pay the full integration scan if the conflict region
  // isn't empty. Single-character INSERTs from a canonical
  // `replicaId:sequence` author seed a typed-run record so that later
  // contiguous events from the same author can extend it in-place (the
  // coalescing branch above). Multi-character INSERTs and IDs that don't
  // parse keep `run = null` and behave like the pre-coalescing engine.
  const firstRun: TypedRun | null =
    parsed !== null && operation.text.length === 1
      ? { replicaId: parsed.replicaId, startSequence: parsed.sequence }
      : null;
  const firstItem: AugmentedCRDTItem = {
    id: `${event.id}:0`,
    eventId: event.id,
    content: codeUnits[0] ?? "",
    originLeft: left,
    originRight,
    everDeleted: false,
    prepareState: 1,
    run: firstRun,
  };
  const useOracle = useLinearIntegrationOracle();
  const indexedFirstPosition = useOracle
    ? null
    : fugueOrder.integrate(firstItem);
  const oracleFirstPosition =
    useOracle && !conflictRegionEmpty
      ? findIntegrationPosition(
          firstItem,
          sequence,
          itemsById,
          recordIntegrationProbe,
        )
      : null;
  if (!useOracle && indexedFirstPosition === null) {
    throw new Error(`Fugue order index unavailable for event ${event.id}`);
  }
  const actualFirstPosition = conflictRegionEmpty
    ? firstInsertPosition
    : useOracle
      ? oracleFirstPosition!
      : indexedFirstPosition!;
  if (
    indexedFirstPosition !== null &&
    indexedFirstPosition !== actualFirstPosition
  ) {
    fugueOrder.invalidate();
  }
  sequence.insert(actualFirstPosition, firstItem);
  itemsById.set(firstItem.id, firstItem);
  originLeftIndex.track(firstItem.id, firstItem.originLeft);
  insertedIds.push(firstItem.id);
  left = firstItem.id;

  // Multi-character inserts: every subsequent item is chained off the
  // previous item via `originLeft`. No record that existed before this
  // event can reference that brand-new id, so the YATA scan for chars
  // 1..N terminates on its first iteration and the integration position
  // is unconditionally `previous + 1`. We bypass the scan and place them
  // at sequential positions instead of paying `findIntegrationPosition`'s
  // setup cost per character. The items stay `run = null` because
  // typed-run coalescing operates on single-character events from
  // contiguous sequence numbers, not on the per-code-unit fragments of
  // one multi-character INSERT.
  for (let offset = 1; offset < codeUnits.length; offset++) {
    const item: AugmentedCRDTItem = {
      id: `${event.id}:${offset}`,
      eventId: event.id,
      content: codeUnits[offset] ?? "",
      originLeft: left,
      originRight,
      everDeleted: false,
      prepareState: 1,
      run: null,
    };
    const expectedPosition = actualFirstPosition + offset;
    const indexedPosition = useOracle ? null : fugueOrder.integrate(item);
    if (!useOracle && indexedPosition === null) {
      throw new Error(`Fugue order index unavailable for event ${event.id}`);
    }
    if (indexedPosition !== null && indexedPosition !== expectedPosition) {
      fugueOrder.invalidate();
    }
    sequence.insert(expectedPosition, item);
    itemsById.set(item.id, item);
    originLeftIndex.track(item.id, item.originLeft);
    insertedIds.push(item.id);
    left = item.id;
  }

  eventItems.set(event.id, insertedIds);

  const firstInserted = requireItem(insertedIds[0] ?? event.id);
  const effectIndex = itemToEffectIndex(firstInserted);
  // A non-coalesced insert (multi-character event, new typed-run seed,
  // or non-empty conflict region) must observe the current document so
  // {@link effectIndex} aligns with the engine's resulting text. Drain
  // any open typed-run buffer before splicing. Hoist the empty-buffer
  // check inline because this is the per-event hot path for non-coalescing
  // inserts and the buffer is empty on every full-replay event.
  if (!pendingInsert.isEmpty()) {
    flushPendingInsert();
  }
  insertText(effectIndex, operation.text);

  return collectTransformedOperations
    ? [
        {
          type: OPERATION_TYPE.INSERT,
          index: effectIndex,
          text: operation.text,
        },
      ]
    : NO_TRANSFORMED_OPERATIONS;
};
