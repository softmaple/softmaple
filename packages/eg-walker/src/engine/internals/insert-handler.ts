import { OPERATION_TYPE } from "../../constants/operation-types";
import { parseEventId } from "../../graph/event-id";
import type { EventId, ExternalOperation } from "../../types";
import type { IndexedSequence } from "../indexed-sequence";
import type { AugmentedCRDTItem, TypedRun } from "./engine-types";
import { EventItemIndex } from "./event-item-index";
import { OriginLeftIndex } from "./origin-left-index";
import { PendingInsertBuffer } from "./pending-insert-buffer";
import { RecordSplitter } from "./record-splitter";
import { FugueOrderIndex } from "./fugue-order-index";
import { findIntegrationPosition } from "./yata-integration";

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
  readonly insertText: (index: number, text: string) => void;
  readonly recordIntegrationProbe: () => void;
  readonly useLinearIntegrationOracle: () => boolean;
}

export interface InsertTailResult {
  item: AugmentedCRDTItem | null;
}

export const applyInsert = (
  eventId: EventId,
  operationIndex: number,
  insertedText: string,
  deps: InsertHandlerDeps,
  collectTransformedOperations: boolean,
  deferTextMaterialization: boolean,
  knownTail: AugmentedCRDTItem | null = null,
  tailResult?: InsertTailResult,
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
    insertText,
    recordIntegrationProbe,
    useLinearIntegrationOracle,
  } = deps;

  if (tailResult !== undefined) {
    tailResult.item = null;
  }

  if (insertedText.length === 0) {
    eventItems.set(eventId, []);
    return NO_TRANSFORMED_OPERATIONS;
  }

  const useOracle = useLinearIntegrationOracle();
  const knownBoundary =
    !useOracle &&
    knownTail !== null &&
    knownTail.prepareState === 1 &&
    !knownTail.everDeleted &&
    !originLeftIndex.has(knownTail.id);
  let firstInsertPosition = -1;
  let originLeftPosition: number | null = null;
  let originLeftRecord: AugmentedCRDTItem | undefined = knownBoundary
    ? (knownTail ?? undefined)
    : undefined;
  let originLeft = originLeftRecord?.id ?? null;
  let originRightPosition: number | null = null;
  let originRight: EventId | null = null;
  let conflictRegionEmpty = knownBoundary;

  if (!knownBoundary) {
    const landing = sequence.prepareBoundaryToPositionAndOffset(operationIndex);
    firstInsertPosition =
      landing.offsetInRecord > 0
        ? recordSplitter.splitRecordAt(landing.position, landing.offsetInRecord)
        : landing.position;
    // YATA-style origins are derived from the event's parent (prepare)
    // version, not from whichever concurrent records happen to be sitting in
    // the sequence right now.
    originLeftPosition =
      sequence.previousPrepareVisiblePosition(firstInsertPosition);
    originLeftRecord =
      originLeftPosition === null ? undefined : sequence.at(originLeftPosition);
    originLeft = originLeftRecord?.id ?? null;

    // A prepare-deleted record still remains an ordering anchor. Start at the
    // first anchor after origin-left instead of skipping zero-width records.
    const anchorSearchStart = (originLeftPosition ?? -1) + 1;
    const candidatePosition =
      sequence.nextPrepareAnchorPosition(anchorSearchStart);
    const candidate =
      candidatePosition === null ? undefined : sequence.at(candidatePosition);
    originRightPosition =
      candidate !== undefined && candidate.originLeft === originLeft
        ? candidatePosition
        : null;
    originRight = originRightPosition === null ? null : (candidate?.id ?? null);

    // The YATA integration scan walks strictly between the two origins. When
    // that interval is empty, the prepare landing is already final.
    const leftBound = originLeftPosition ?? -1;
    const rightBound = originRightPosition ?? sequence.length;
    conflictRegionEmpty =
      leftBound + 1 === firstInsertPosition &&
      firstInsertPosition === rightBound;
  }

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
  const parsed = parseEventId(eventId);
  const coalescingBoundary = knownBoundary
    ? originLeftRecord !== undefined && sequence.isLast(originLeftRecord)
    : originLeftPosition !== null &&
      originLeftPosition === firstInsertPosition - 1;
  if (
    conflictRegionEmpty &&
    insertedText.length === 1 &&
    parsed !== null &&
    coalescingBoundary
  ) {
    const leftRecord = originLeftRecord;
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
      !originLeftIndex.has(leftRecord.id) &&
      eventItems.canExtendRunItem(leftRecord, insertedText.length)
    ) {
      if (typeof leftRecord.content !== "string") {
        throw new Error("Typed-run content must be materialized text");
      }
      const previousLength = leftRecord.content.length;
      leftRecord.content += insertedText;
      sequence.updateItem(leftRecord);
      if (tailResult !== undefined) {
        tailResult.item = leftRecord;
      }
      if (deferTextMaterialization) {
        return NO_TRANSFORMED_OPERATIONS;
      }
      const effectIndex = itemToEffectIndex(leftRecord) + previousLength;
      // Defer the splice on the engine's resulting text into the
      // pending-insert buffer so a long single-author typed run doesn't
      // pay an O(document length) string realloc per keystroke.
      // {@link flushPendingInsert} materialises the buffer before any
      // non-coalesced read or write of the document text.
      pendingInsert.append(effectIndex, insertedText, applyPendingSplice);

      return collectTransformedOperations
        ? [
            {
              type: OPERATION_TYPE.INSERT,
              index: effectIndex,
              text: insertedText,
            },
          ]
        : NO_TRANSFORMED_OPERATIONS;
    }
  }

  const insertedIds: EventId[] | null = insertedText.length === 1 ? null : [];
  let left = originLeft;

  // First code unit: pay the full integration scan if the conflict region
  // isn't empty. Single-character INSERTs from a canonical
  // `replicaId:sequence` author seed a typed-run record so that later
  // contiguous events from the same author can extend it in-place (the
  // coalescing branch above). Multi-character INSERTs and IDs that don't
  // parse keep `run = null` and behave like the pre-coalescing engine.
  const firstRun: TypedRun | null =
    parsed !== null && insertedText.length === 1
      ? { replicaId: parsed.replicaId, startSequence: parsed.sequence }
      : null;
  const firstItem: AugmentedCRDTItem = {
    id: `${eventId}:0`,
    eventId,
    content: insertedText[0] ?? "",
    originLeft: left,
    originRight,
    everDeleted: false,
    prepareState: 1,
    run: firstRun,
  };
  const indexedFirstPosition =
    useOracle || conflictRegionEmpty ? null : fugueOrder.integrate(firstItem);
  const indexedKnownPositionIntegrated =
    useOracle || !conflictRegionEmpty
      ? true
      : fugueOrder.integrateAtKnownPosition(firstItem);
  const oracleFirstPosition =
    useOracle && !conflictRegionEmpty
      ? findIntegrationPosition(
          firstItem,
          sequence,
          itemsById,
          recordIntegrationProbe,
        )
      : null;
  if (
    !useOracle &&
    (indexedKnownPositionIntegrated === false ||
      (!conflictRegionEmpty && indexedFirstPosition === null))
  ) {
    throw new Error(`Fugue order index unavailable for event ${eventId}`);
  }
  const actualFirstPosition = knownBoundary
    ? -1
    : conflictRegionEmpty
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
  if (knownBoundary) {
    if (
      originLeftRecord === undefined ||
      !sequence.insertAfter(originLeftRecord, firstItem)
    ) {
      throw new Error(`Known insert boundary unavailable for event ${eventId}`);
    }
  } else {
    sequence.insert(actualFirstPosition, firstItem);
  }
  itemsById.set(firstItem.id, firstItem);
  originLeftIndex.track(firstItem.id, firstItem.originLeft);
  insertedIds?.push(firstItem.id);
  left = firstItem.id;
  let tailItem = firstItem;

  // Multi-character inserts: every subsequent item is chained off the
  // previous item via `originLeft`. No record that existed before this
  // event can reference that brand-new id, so the YATA scan for chars
  // 1..N terminates on its first iteration and the integration position
  // is unconditionally `previous + 1`. We bypass the scan and place them
  // immediately after the previous object instead of paying numeric rank
  // lookups or `findIntegrationPosition` setup per character. The items stay
  // `run = null` because
  // typed-run coalescing operates on single-character events from
  // contiguous sequence numbers, not on the per-code-unit fragments of
  // one multi-character INSERT.
  for (let offset = 1; offset < insertedText.length; offset++) {
    const item: AugmentedCRDTItem = {
      id: `${eventId}:${offset}`,
      eventId,
      content: insertedText[offset] ?? "",
      originLeft: left,
      originRight,
      everDeleted: false,
      prepareState: 1,
      run: null,
    };
    const indexedIntegrated =
      useOracle || fugueOrder.integrateAtKnownPosition(item);
    if (!indexedIntegrated) {
      throw new Error(`Fugue order index unavailable for event ${eventId}`);
    }
    if (!sequence.insertAfter(tailItem, item)) {
      throw new Error(`Insert tail unavailable for event ${eventId}`);
    }
    itemsById.set(item.id, item);
    originLeftIndex.track(item.id, item.originLeft);
    insertedIds?.push(item.id);
    left = item.id;
    tailItem = item;
  }

  if (tailResult !== undefined) {
    tailResult.item = tailItem;
  }

  if (insertedIds === null) {
    if (firstItem.run === null) {
      eventItems.setOne(eventId, firstItem.id);
    } else {
      eventItems.registerRunItem(firstItem);
    }
  } else {
    eventItems.set(eventId, insertedIds);
  }

  // Cold replay callers only need the final document. The sequence already
  // carries the authoritative effect-visible state, so avoid an effect-rank
  // lookup and persistent-rope splice for every historical insert. The
  // engine materializes the final rope once after replay completes.
  if (deferTextMaterialization) {
    return NO_TRANSFORMED_OPERATIONS;
  }

  const effectIndex = itemToEffectIndex(firstItem);
  // A non-coalesced insert (multi-character event, new typed-run seed,
  // or non-empty conflict region) must observe the current document so
  // {@link effectIndex} aligns with the engine's resulting text. Drain
  // any open typed-run buffer before splicing. Hoist the empty-buffer
  // check inline because this is the per-event hot path for non-coalescing
  // inserts and the buffer is empty on every full-replay event.
  if (!pendingInsert.isEmpty()) {
    flushPendingInsert();
  }
  insertText(effectIndex, insertedText);

  return collectTransformedOperations
    ? [
        {
          type: OPERATION_TYPE.INSERT,
          index: effectIndex,
          text: insertedText,
        },
      ]
    : NO_TRANSFORMED_OPERATIONS;
};
