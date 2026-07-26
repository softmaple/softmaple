import type { EventId, ExternalOperation } from "../../types";
import type { IndexedSequence } from "../indexed-sequence";
import { DeleteTargetIndex } from "./delete-target-index";
import { PLACEHOLDER_EVENT_ID, type AugmentedCRDTItem } from "./engine-types";
import { PendingInsertBuffer } from "./pending-insert-buffer";
import { RecordSplitter } from "./record-splitter";
import { coalesceDeleteRuns } from "./text-utils";

const NO_TRANSFORMED_OPERATIONS: ReadonlyArray<ExternalOperation> =
  Object.freeze([]);

export interface DeleteHandlerDeps {
  readonly sequence: IndexedSequence<AugmentedCRDTItem>;
  readonly deleteTargets: DeleteTargetIndex;
  readonly recordSplitter: RecordSplitter;
  readonly pendingInsert: PendingInsertBuffer;
  readonly flushPendingInsert: () => void;
  readonly itemToEffectIndex: (target: AugmentedCRDTItem) => number;
  readonly deleteText: (index: number, length: number) => void;
}

export const applyDelete = (
  eventId: EventId | null,
  operationIndex: number,
  operationLength: number,
  deps: DeleteHandlerDeps,
  collectTransformedOperations: boolean,
  deferTextMaterialization: boolean,
  packedOrderIndex?: number,
): ReadonlyArray<ExternalOperation> => {
  if (eventId === null && packedOrderIndex === undefined) {
    throw new Error("Delete event ID is required outside packed replay");
  }
  const {
    sequence,
    deleteTargets,
    recordSplitter,
    pendingInsert,
    flushPendingInsert,
    itemToEffectIndex,
    deleteText,
  } = deps;
  if (packedOrderIndex !== undefined) {
    // Packed-order validation must precede every sequence, text, and target
    // mutation. The commit below is then infallible for this replay step.
    deleteTargets.assertPackedOrderAvailable(packedOrderIndex);
  }

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
  const targetGroup = deleteTargets.beginRecord();
  const outputDeleteIndexes: number[] | null = collectTransformedOperations
    ? []
    : null;
  let remaining = operationLength;

  try {
    while (remaining > 0) {
      const landing = sequence.prepareIndexToPositionAndOffset(
        operationIndex,
        false,
      );
      const candidate = sequence.at(landing.position);
      if (!candidate) {
        // The ranked B-tree just told us the prepare-weight prefix sum lands
        // on `landing.position`, so a missing record there means the tree's
        // aggregates disagree with its children — a structural bug we want to
        // surface, not silently truncate the delete around.
        throw new Error(
          `Engine bug: prepare-index ${operationIndex} landed at sequence position ` +
            `${landing.position} but no record exists there (remaining=${remaining}).`,
        );
      }

      const placeholder = candidate.placeholder;
      if (placeholder !== undefined) {
        const state = placeholder.state;
        if (deferTextMaterialization) {
          if (remaining === 1) {
            const absoluteOffset = placeholder.start + landing.offsetInRecord;
            state.deletePrepareVisibleUnitInSlice(
              placeholder,
              landing.offsetInRecord,
            );
            deleteTargets.appendPlaceholderRange(
              targetGroup,
              state,
              absoluteOffset,
              absoluteOffset + 1,
            );
            sequence.updateItem(candidate);
            remaining = 0;
            continue;
          }
          const result = state.deletePrepareVisibleInSlice(
            placeholder,
            landing.offsetInRecord,
            remaining,
          );
          let deletedLength = 0;
          for (const range of result.ranges) {
            deleteTargets.appendPlaceholderRange(
              targetGroup,
              state,
              range.start,
              range.end,
            );
            deletedLength += range.end - range.start;
          }
          if (deletedLength === 0) {
            throw new Error(
              `Engine bug: segmented placeholder ${candidate.id} had positive prepare weight but no visible range`,
            );
          }
          sequence.updateItem(candidate);
          remaining -= deletedLength;
          continue;
        }

        const absoluteStart = placeholder.start + landing.offsetInRecord;
        const ranges = state.collectPrepareVisibleRanges(
          absoluteStart,
          placeholder.end,
          remaining,
        );
        let deletedLength = 0;
        const affected = new Set<AugmentedCRDTItem>();
        for (const range of ranges) {
          deleteTargets.appendPlaceholderRange(
            targetGroup,
            state,
            range.start,
            range.end,
          );

          if (!deferTextMaterialization) {
            const effectRanges = state.collectEffectVisibleRanges(
              range.start,
              range.end,
            );
            // Delete disjoint effect-visible spans from right to left. Removing
            // an earlier span first would shift the effect indexes of every
            // later span while the placeholder state still describes the
            // pre-delete document.
            for (let index = effectRanges.length - 1; index >= 0; index--) {
              const effectRange = effectRanges[index];
              if (effectRange === undefined) {
                continue;
              }
              const effectIndex =
                itemToEffectIndex(candidate) +
                state.effectLengthInRange(placeholder.start, effectRange.start);
              const effectLength = effectRange.end - effectRange.start;
              if (collectTransformedOperations) {
                for (let index = 0; index < effectLength; index++) {
                  outputDeleteIndexes?.push(effectIndex);
                }
              }
              deleteText(effectIndex, effectLength);
            }
          }

          for (const slice of state.applyDeleteRange(range.start, range.end)) {
            const owner = slice.owner;
            if (owner !== null) {
              affected.add(owner);
            }
          }
          deletedLength += range.end - range.start;
        }
        if (deletedLength === 0) {
          throw new Error(
            `Engine bug: segmented placeholder ${candidate.id} had positive prepare weight but no visible range`,
          );
        }
        sequence.updateItems(affected);
        remaining -= deletedLength;
        continue;
      }

      // Multi-character records (placeholders and typed-run leaves coalesced
      // by Section 3.4) are split on demand so the deleted slice is its own
      // record. Single-character records and per-code-unit paste fragments
      // skip the split entirely and are marked in place.
      const isMultiCharRecord =
        (candidate.eventId === PLACEHOLDER_EVENT_ID ||
          candidate.run !== null) &&
        candidate.content.length > 1;
      if (isMultiCharRecord) {
        const availableInRecord =
          candidate.content.length - landing.offsetInRecord;
        const toDelete = Math.min(remaining, availableInRecord);
        const middle = recordSplitter.splitRecordForDelete(
          candidate,
          landing.offsetInRecord,
          toDelete,
        );

        deleteTargets.appendItem(targetGroup, middle.id);
        // A concurrent delete that lands on an already-effect-deleted slice
        // (e.g. after retreating an overlapping sibling) must NOT remove
        // characters from the text again. Without this, two concurrent
        // deletes of the same region replay to a shorter string than full
        // replay produces.
        if (!middle.everDeleted) {
          if (!deferTextMaterialization) {
            const effectIndex = itemToEffectIndex(middle);
            if (collectTransformedOperations) {
              for (let k = 0; k < toDelete; k++) {
                outputDeleteIndexes?.push(effectIndex);
              }
            }
            deleteText(effectIndex, toDelete);
          }
        }

        middle.everDeleted = true;
        middle.prepareState += 1;
        sequence.updateItem(middle);
        remaining -= toDelete;
        continue;
      }

      deleteTargets.appendItem(targetGroup, candidate.id);
      if (!candidate.everDeleted) {
        if (!deferTextMaterialization) {
          const effectIndex = itemToEffectIndex(candidate);
          if (collectTransformedOperations) {
            outputDeleteIndexes?.push(effectIndex);
          }
          deleteText(effectIndex, 1);
        }
      }
      candidate.everDeleted = true;
      candidate.prepareState += 1;
      sequence.updateItem(candidate);
      remaining -= 1;
    }
  } catch (error) {
    deleteTargets.abortRecord(targetGroup);
    throw error;
  }

  if (packedOrderIndex === undefined) {
    deleteTargets.commitRecord(eventId!, targetGroup);
  } else {
    deleteTargets.commitPackedRecord(packedOrderIndex, targetGroup);
  }

  return outputDeleteIndexes === null
    ? NO_TRANSFORMED_OPERATIONS
    : coalesceDeleteRuns(outputDeleteIndexes);
};
