import { OPERATION_TYPE } from "../../constants/operation-types";
import type { EventId, ExternalOperation } from "../../types";
import type { IndexedSequence } from "../indexed-sequence";
import {
  CUSTOM_EVENT_AGENT,
  type AugmentedCRDTItem,
  type ItemKey,
  type ItemTable,
} from "./engine-types";
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
  readonly items: ItemTable;
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
  /** Formats an item's event ID for the linear oracle's tie-breaks. */
  readonly eventIdOf: (item: AugmentedCRDTItem) => EventId;
}

export interface InsertTailResult {
  item: AugmentedCRDTItem | null;
}

/**
 * Shared eligibility gate for scalar and packed typed-run extension.
 *
 * The caller proves that the insert lands immediately after `item` in the
 * prepare view. This helper owns every mutable run invariant, including the
 * cached successor bound in {@link EventItemIndex}; packed replay must never
 * append a span by checking only document position.
 */
export const canExtendTypedRun = (
  item: AugmentedCRDTItem,
  agent: number,
  startSequence: number,
  additionalLength: number,
  deps: InsertHandlerDeps,
): boolean =>
  typeof item.content === "string" &&
  item.run &&
  item.agent === agent &&
  item.sequence + item.content.length === startSequence &&
  item.prepareState === 1 &&
  !item.everDeleted &&
  !deps.originLeftIndex.has(item.id) &&
  deps.eventItems.canExtendRunItem(item, additionalLength);

/**
 * Extend an already-validated typed run with one sequence/tree update.
 * Returns the effect insertion index when text materialization is eager.
 */
export const applyTypedRunExtension = (
  item: AugmentedCRDTItem,
  insertedText: string,
  deps: InsertHandlerDeps,
  deferTextMaterialization: boolean,
): number | null => {
  if (typeof item.content !== "string" || insertedText.length === 0) {
    throw new Error("Typed-run extension requires materialized text");
  }
  const previousLength = item.content.length;
  item.content += insertedText;
  deps.sequence.updateItem(item);
  if (deferTextMaterialization) {
    return null;
  }

  const effectIndex = deps.itemToEffectIndex(item) + previousLength;
  deps.pendingInsert.append(effectIndex, insertedText, deps.applyPendingSplice);
  return effectIndex;
};

/**
 * Integrate the insert event at `localVersion`.
 *
 * `agent` and `eventSequence` are the event's canonical ID parts, or
 * {@link CUSTOM_EVENT_AGENT} for an event whose ID is not canonical.
 */
export const applyInsert = (
  localVersion: number,
  agent: number,
  eventSequence: number,
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
    items,
    eventItems,
    originLeftIndex,
    recordSplitter,
    fugueOrder,
    pendingInsert,
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
    eventItems.set(localVersion, []);
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
  let originRight: ItemKey | null = null;
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
  const canonical = agent >= 0;
  const coalescingBoundary = knownBoundary
    ? originLeftRecord !== undefined && sequence.isLast(originLeftRecord)
    : originLeftPosition !== null &&
      originLeftPosition === firstInsertPosition - 1;
  if (
    conflictRegionEmpty &&
    insertedText.length === 1 &&
    canonical &&
    coalescingBoundary
  ) {
    const leftRecord = originLeftRecord;
    if (
      leftRecord !== undefined &&
      canExtendTypedRun(
        leftRecord,
        agent,
        eventSequence,
        insertedText.length,
        deps,
      )
    ) {
      const effectIndex = applyTypedRunExtension(
        leftRecord,
        insertedText,
        deps,
        deferTextMaterialization,
      );
      if (tailResult !== undefined) {
        tailResult.item = leftRecord;
      }
      if (deferTextMaterialization) {
        return NO_TRANSFORMED_OPERATIONS;
      }
      if (effectIndex === null) {
        throw new Error("Typed-run extension did not produce an effect index");
      }

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

  // The whole insert becomes one record with the origins of its first code
  // unit, so the integration scan runs once, and only when the conflict
  // region isn't empty. Single-character INSERTs from a canonical
  // `replicaId:sequence` author seed a typed-run record so that later
  // contiguous events from the same author can extend it in-place (the
  // coalescing branch above). A multi-character INSERT becomes an insert-run
  // record standing for the chain of per-code-unit items in which each code
  // unit's left origin is the one before it. No existing record can name a
  // code unit of a brand-new event, so that chain always lands contiguously.
  // A later insert or delete inside the run splits it there (RecordSplitter)
  // instead of every code unit costing an item, B-tree slots and a Fugue node
  // up front.
  const firstItem: AugmentedCRDTItem = {
    id: items.nextKey(),
    agent: canonical ? agent : CUSTOM_EVENT_AGENT,
    sequence: canonical ? eventSequence : localVersion,
    offset: 0,
    content: insertedText,
    originLeft,
    originRight,
    everDeleted: false,
    prepareState: 1,
    run: canonical && insertedText.length === 1,
    placeholder: undefined,
    external: undefined,
    sequenceLeaf: null,
    runNode: null,
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
          items,
          deps.eventIdOf,
          recordIntegrationProbe,
        )
      : null;
  if (
    !useOracle &&
    (indexedKnownPositionIntegrated === false ||
      (!conflictRegionEmpty && indexedFirstPosition === null))
  ) {
    throw new Error(`Fugue order index unavailable for event ${localVersion}`);
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
      throw new Error(
        `Known insert boundary unavailable for event ${localVersion}`,
      );
    }
  } else {
    sequence.insert(actualFirstPosition, firstItem);
  }
  items.add(firstItem);
  originLeftIndex.track(firstItem.id, firstItem.originLeft);

  if (tailResult !== undefined) {
    tailResult.item = firstItem;
  }

  if (firstItem.run) {
    eventItems.registerRunItem(firstItem);
  } else if (insertedText.length === 1) {
    eventItems.setOne(localVersion, firstItem.id);
  } else {
    eventItems.setInsertRun(localVersion, firstItem.id);
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
