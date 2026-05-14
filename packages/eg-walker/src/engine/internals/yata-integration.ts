import { compareEventIds } from "../../graph/event-id";
import type { EventId } from "../../types";
import type { IndexedSequence } from "../indexed-sequence";
import type { AugmentedCRDTItem } from "./engine-types";

/**
 * YATA-style integration scan (Nicolaescu et al., 2016; Yjs `Item.integrate`).
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
  const scanned = new Set<EventId>();
  let conflicting = new Set<EventId>();

  while (scanPos < rightPos) {
    const other = sequence.at(scanPos);
    if (!other) {
      break;
    }
    scanned.add(other.id);
    conflicting.add(other.id);

    if (other.originLeft === item.originLeft) {
      // Same left anchor: tie-break by event ID (smaller wins, goes
      // first). If `other` has a larger event ID and shares our right
      // anchor, the new item is placed immediately before it. If the
      // right anchors differ, fall through and continue scanning.
      if (compareEventIds(other.eventId, item.eventId) < 0) {
        insertPos = scanPos + 1;
        conflicting = new Set();
      } else if (other.originRight === item.originRight) {
        break;
      }
    } else if (
      other.originLeft !== null &&
      scanned.has(other.originLeft) &&
      !conflicting.has(other.originLeft)
    ) {
      // `other`'s left anchor is a record we have already accepted as
      // belonging to the left of the new item, so the new item must
      // continue past `other` too.
      insertPos = scanPos + 1;
      conflicting = new Set();
    } else if (other.originLeft === null || !scanned.has(other.originLeft)) {
      // `other`'s left anchor sits outside the conflict region (either
      // null or a record we have not passed yet), so `other` dominates
      // the remaining slice and the new item stays before it.
      break;
    }
    scanPos++;
  }

  return insertPos;
};
