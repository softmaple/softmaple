import { OPERATION_TYPE } from "../../constants/operation-types";
import type { EventId, ExternalOperation, GraphEvent } from "../../types";
import type { IndexedSequence } from "../indexed-sequence";
import { DeleteTargetIndex } from "./delete-target-index";
import { PLACEHOLDER_EVENT_ID, type AugmentedCRDTItem } from "./engine-types";
import { PendingInsertBuffer } from "./pending-insert-buffer";
import { RecordSplitter } from "./record-splitter";
import { coalesceDeleteRuns, deleteText } from "./text-utils";

type DeleteOperation = Extract<
  ExternalOperation,
  { type: typeof OPERATION_TYPE.DELETE }
>;

export interface DeleteHandlerDeps {
  readonly sequence: IndexedSequence<AugmentedCRDTItem>;
  readonly deleteTargets: DeleteTargetIndex;
  readonly recordSplitter: RecordSplitter;
  readonly pendingInsert: PendingInsertBuffer;
  readonly flushPendingInsert: () => void;
  readonly itemToEffectIndex: (target: AugmentedCRDTItem) => number;
  readonly getResultingText: () => string;
  readonly setResultingText: (text: string) => void;
}

export const applyDelete = (
  event: GraphEvent,
  operation: DeleteOperation,
  deps: DeleteHandlerDeps,
): ExternalOperation[] => {
  const {
    sequence,
    deleteTargets,
    recordSplitter,
    pendingInsert,
    flushPendingInsert,
    itemToEffectIndex,
    getResultingText,
    setResultingText,
  } = deps;

  // Any concurrent insert or delete breaks the typed-run we may have been
  // coalescing into the pending-insert buffer. Flush before we start carving
  // records and slicing the document text so the per-slot {@link effectIndex}
  // arithmetic below operates on the materialised document. Hoist the
  // empty-buffer check inline because `applyDelete` is on the per-event hot
  // path and the buffer is empty on every non-coalescing trace, so the
  // inline check saves a function call on the common case.
  if (!pendingInsert.isEmpty()) {
    flushPendingInsert();
  }
  const deletedItemIds: EventId[] = [];
  const outputDeleteIndexes: number[] = [];
  let remaining = operation.length;

  while (remaining > 0) {
    // A delete event whose `length` runs past the prepare-visible items at
    // the engine's current parent version legitimately stops short — this is
    // exercised by the "deletes that run past visible prepare items" test.
    // The previous implementation wrapped the throwing
    // `prepareIndexToPositionAndOffset` in a catch-all try/catch, which also
    // swallowed real bugs (e.g. ranked-B-tree aggregate corruption). Use the
    // explicit non-throwing variant for the expected end-of-text case, and
    // let other errors surface.
    const landing = sequence.tryPrepareIndexToPositionAndOffset(
      operation.index,
      false,
    );
    if (!landing) {
      break;
    }
    const candidate = sequence.at(landing.position);
    if (!candidate) {
      // The ranked B-tree just told us the prepare-weight prefix sum lands
      // on `landing.position`, so a missing record there means the tree's
      // aggregates disagree with its children — a structural bug we want to
      // surface, not silently truncate the delete around.
      throw new Error(
        `Engine bug: prepare-index ${operation.index} landed at sequence position ` +
          `${landing.position} but no record exists there (remaining=${remaining}).`,
      );
    }

    // Multi-character records (placeholders and typed-run leaves coalesced
    // by Section 3.4) are split on demand so the deleted slice is its own
    // record. Single-character records and per-code-unit paste fragments
    // skip the split entirely and are marked in place.
    const isMultiCharRecord =
      (candidate.eventId === PLACEHOLDER_EVENT_ID || candidate.run !== null) &&
      candidate.content.length > 1;
    if (isMultiCharRecord) {
      const availableInRecord =
        candidate.content.length - landing.offsetInRecord;
      const toDelete = Math.min(remaining, availableInRecord);
      const middle = recordSplitter.splitRecordForDelete(
        landing.position,
        landing.offsetInRecord,
        toDelete,
      );

      deletedItemIds.push(middle.id);
      // A concurrent delete that lands on an already-effect-deleted slice
      // (e.g. after retreating an overlapping sibling) must NOT remove
      // characters from the text again. Without this, two concurrent
      // deletes of the same region replay to a shorter string than full
      // replay produces.
      if (!middle.everDeleted) {
        const effectIndex = itemToEffectIndex(middle);
        for (let k = 0; k < toDelete; k++) {
          outputDeleteIndexes.push(effectIndex);
        }
        setResultingText(deleteText(getResultingText(), effectIndex, toDelete));
      }

      middle.everDeleted = true;
      middle.prepareState += 1;
      sequence.updateItem(middle);
      remaining -= toDelete;
      continue;
    }

    deletedItemIds.push(candidate.id);
    if (!candidate.everDeleted) {
      const effectIndex = itemToEffectIndex(candidate);
      outputDeleteIndexes.push(effectIndex);
      setResultingText(deleteText(getResultingText(), effectIndex, 1));
    }
    candidate.everDeleted = true;
    candidate.prepareState += 1;
    sequence.updateItem(candidate);
    remaining -= 1;
  }

  deleteTargets.record(event.id, deletedItemIds);

  return coalesceDeleteRuns(outputDeleteIndexes);
};
