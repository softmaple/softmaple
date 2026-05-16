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

  if (!pendingInsert.isEmpty()) {
    flushPendingInsert();
  }
  const deletedItemIds: EventId[] = [];
  const outputDeleteIndexes: number[] = [];
  let remaining = operation.length;

  while (remaining > 0) {
    const landing = sequence.tryPrepareIndexToPositionAndOffset(
      operation.index,
      false,
    );
    if (!landing) {
      break;
    }
    const candidate = sequence.at(landing.position);
    if (!candidate) {
      throw new Error(
        `Engine bug: prepare-index ${operation.index} landed at sequence position ` +
          `${landing.position} but no record exists there (remaining=${remaining}).`,
      );
    }

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
