import { parseEventId } from "../../graph/event-id";
import type { EventId } from "../../types";
import type { AugmentedCRDTItem } from "./engine-types";

type StoredEventItems = EventId | EventId[];
export type EventItems = EventId | ReadonlyArray<EventId>;

/**
 * Event-id -> CRDT item lookup used by retreat / advance.
 *
 * Normal multi-character insert events keep direct map entries because one
 * event can own multiple CRDT items. Coalesced typed-run records are cheaper:
 * a record spans a contiguous `${replicaId}:${sequence}` range, so snapshot
 * restore can register the range once instead of materializing one map entry
 * and one string per character event.
 */
export class EventItemIndex {
  private readonly direct = new Map<EventId, StoredEventItems>();
  private readonly runItemsByReplica = new Map<string, AugmentedCRDTItem[]>();
  private sortedRunReplicas = new Set<string>();

  clear(): void {
    this.direct.clear();
    this.runItemsByReplica.clear();
    this.sortedRunReplicas.clear();
  }

  set(eventId: EventId, itemIds: EventId[]): void {
    this.direct.set(eventId, itemIds.length === 1 ? itemIds[0]! : itemIds);
  }

  /** Store the dominant one-event/one-record case without a wrapper array. */
  setOne(eventId: EventId, itemId: EventId): void {
    this.direct.set(eventId, itemId);
  }

  add(eventId: EventId, itemId: EventId): void {
    const items = this.direct.get(eventId);
    if (items === undefined) {
      this.direct.set(eventId, itemId);
      return;
    }
    if (typeof items !== "string") {
      items.push(itemId);
      return;
    }
    this.direct.set(eventId, [items, itemId]);
  }

  /**
   * Resolve to a scalar for one-record events and an array only when the
   * event genuinely owns multiple records. Callers must treat returned arrays
   * as read-only; avoiding a scalar wrapper is load-bearing on replay diffs.
   */
  get(eventId: EventId): EventItems | undefined {
    const direct = this.direct.get(eventId);
    if (direct !== undefined) {
      return direct;
    }

    const parsed = parseEventId(eventId);
    if (parsed === null) {
      return undefined;
    }

    const item = this.findRunItem(parsed.replicaId, parsed.sequence);
    return item?.id;
  }

  registerRunItem(item: AugmentedCRDTItem): void {
    if (item.run === null) {
      return;
    }
    const items = this.runItemsByReplica.get(item.run.replicaId);
    if (items) {
      items.push(item);
      this.sortedRunReplicas.delete(item.run.replicaId);
      return;
    }
    this.runItemsByReplica.set(item.run.replicaId, [item]);
    this.sortedRunReplicas.add(item.run.replicaId);
  }

  rewriteDirectReferencesForRunSplit(
    left: AugmentedCRDTItem,
    right: AugmentedCRDTItem,
    offsetInRecord: number,
    leftOriginalLength: number,
  ): void {
    if (left.run === null) {
      return;
    }
    const runStart = left.run.startSequence + offsetInRecord;
    const runEnd = left.run.startSequence + leftOriginalLength;
    for (let sequence = runStart; sequence < runEnd; sequence++) {
      const eventId: EventId = `${left.run.replicaId}:${sequence}`;
      const direct = this.direct.get(eventId);
      if (direct === undefined) {
        continue;
      }
      if (!Array.isArray(direct)) {
        if (direct === left.id) {
          this.direct.set(eventId, right.id);
        }
        continue;
      }
      let mutated = false;
      const next = direct.map((id) => {
        if (id === left.id) {
          mutated = true;
          return right.id;
        }
        return id;
      });
      if (mutated) {
        this.direct.set(eventId, next);
      }
    }
  }

  private findRunItem(
    replicaId: string,
    sequence: number,
  ): AugmentedCRDTItem | null {
    const items = this.runItemsByReplica.get(replicaId);
    if (!items || items.length === 0) {
      return null;
    }
    const sortedItems = this.sortRunItems(replicaId, items);

    let low = 0;
    let high = sortedItems.length - 1;
    let candidate: AugmentedCRDTItem | null = null;
    while (low <= high) {
      const mid = low + Math.floor((high - low) / 2);
      const item = sortedItems[mid]!;
      const start = item.run!.startSequence;
      if (start <= sequence) {
        candidate = item;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    if (
      candidate?.run &&
      sequence < candidate.run.startSequence + candidate.content.length
    ) {
      return candidate;
    }
    return null;
  }

  private sortRunItems(
    replicaId: string,
    items: AugmentedCRDTItem[],
  ): AugmentedCRDTItem[] {
    if (this.sortedRunReplicas.has(replicaId)) {
      return items;
    }
    const sorted = [...items].sort(
      (left, right) => left.run!.startSequence - right.run!.startSequence,
    );
    this.runItemsByReplica.set(replicaId, sorted);
    this.sortedRunReplicas.add(replicaId);
    return sorted;
  }
}
