import { compareEventIds } from "../../graph/event-id";
import type { EventId } from "../../types";
import type { IndexedSequence } from "../indexed-sequence";
import type { AugmentedCRDTItem } from "./engine-types";

/**
 * YjsMod / Fugue-family integration scan used by the paper's reference
 * implementation.
 *
 * The destination range is the slice of the sequence strictly between
 * `originLeft` and `originRight`. Walk it left-to-right and decide,
 * for each concurrent neighbour, whether the new item belongs before
 * or after it. The decision depends only on the two items' origins and
 * event IDs, never on the order in which concurrent siblings were
 * integrated, so the engine converges to the same sequence regardless
 * of which valid topological order the caller hands it.
 *
 * Two concurrent items with identical origins are ordered by
 * {@link compareEventIds}: the smaller event ID wins and is placed
 * first, matching Yjs's `id.client` tie-break.
 */
export const findIntegrationPosition = (
  item: AugmentedCRDTItem,
  sequence: IndexedSequence<AugmentedCRDTItem>,
  itemsById: ReadonlyMap<EventId, AugmentedCRDTItem>,
): number => {
  const leftItem = item.originLeft ? itemsById.get(item.originLeft) : null;
  const rightItem = item.originRight ? itemsById.get(item.originRight) : null;
  const leftPos = leftItem ? sequence.positionOf(leftItem) : -1;
  const rightPos = rightItem ? sequence.positionOf(rightItem) : sequence.length;

  let insertPos = leftPos + 1;
  let scanPos = leftPos + 1;
  let scanCandidate = scanPos;
  let scanning = false;

  while (scanPos < rightPos) {
    const other = sequence.at(scanPos);
    if (!other) {
      break;
    }

    // The scan only crosses concurrent records that were not inserted yet in
    // this event's prepare version. `originRight` and any other record already
    // present in prepare bound the conflict interval.
    if (other.id === item.originRight || other.prepareState !== 0) {
      break;
    }

    if (other.originLeft === item.originLeft) {
      if (other.originRight === item.originRight) {
        // Identical origin tuples are truly concurrent siblings. Their stable
        // event-id order is the final tie-break.
        if (compareEventIds(item.eventId, other.eventId) < 0) {
          break;
        }
        scanning = false;
      } else {
        // Same left origin but different right origins: order the nested
        // ranges by the positions of their right anchors. `scanCandidate`
        // remembers the start of a nested region in case a later neighbour
        // proves that the new item belongs before the whole region.
        const otherRight =
          other.originRight === null ? null : itemsById.get(other.originRight);
        const otherRightPos =
          otherRight === undefined || otherRight === null
            ? sequence.length
            : sequence.positionOf(otherRight);
        if (otherRightPos < rightPos) {
          if (!scanning) {
            scanning = true;
            scanCandidate = scanPos;
          }
        } else {
          scanning = false;
        }
      }
    } else {
      const otherLeft =
        other.originLeft === null ? null : itemsById.get(other.originLeft);
      const otherLeftPos =
        otherLeft === undefined || otherLeft === null
          ? -1
          : sequence.positionOf(otherLeft);
      if (otherLeftPos < leftPos) {
        break;
      }
    }

    scanPos++;
    if (!scanning) {
      insertPos = scanPos;
    }
  }

  return scanning ? scanCandidate : insertPos;
};
