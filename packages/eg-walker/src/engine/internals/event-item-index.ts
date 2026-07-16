import { parseEventId } from "../../graph/event-id";
import type { EventId } from "../../types";
import type { AugmentedCRDTItem } from "./engine-types";

type StoredEventItems = EventId | EventId[];
export type EventItems = EventId | ReadonlyArray<EventId>;

interface RunItemNode {
  readonly item: AugmentedCRDTItem;
  readonly startSequence: number;
  readonly priority: number;
  nextStartSequence: number;
  left: RunItemNode | null;
  right: RunItemNode | null;
}

/**
 * Event-id -> CRDT item lookup used by retreat / advance.
 *
 * Normal multi-character insert events keep direct map entries because one
 * event can own multiple CRDT items. Coalesced typed-run records are cheaper:
 * a record spans a contiguous `${replicaId}:${sequence}` range, so replay and
 * snapshot restore register the range once instead of materializing one map
 * entry and one string per character event. Each author's ranges live in a
 * deterministic treap, keeping arbitrary split/lookup order logarithmic.
 */
export class EventItemIndex {
  private readonly direct = new Map<EventId, StoredEventItems>();
  private readonly runRootsByReplica = new Map<string, RunItemNode>();
  private runNodesByItem = new WeakMap<AugmentedCRDTItem, RunItemNode>();

  clear(): void {
    this.direct.clear();
    this.runRootsByReplica.clear();
    this.runNodesByItem = new WeakMap<AugmentedCRDTItem, RunItemNode>();
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

  /** Resolve a canonical scalar event without formatting or parsing its ID. */
  getRunItem(
    replicaId: string,
    sequence: number,
  ): AugmentedCRDTItem | undefined {
    return this.findRunItem(replicaId, sequence) ?? undefined;
  }

  registerRunItem(item: AugmentedCRDTItem): void {
    const run = item.run;
    if (run === null) {
      return;
    }
    if (item.content.length <= 0) {
      throw new Error(`Typed run ${item.id} must have positive length`);
    }
    const endSequence = run.startSequence + item.content.length;
    if (!Number.isSafeInteger(endSequence)) {
      throw new Error(`Typed run ${item.id} exceeds the safe sequence range`);
    }

    const root = this.runRootsByReplica.get(run.replicaId) ?? null;
    const predecessor = findRunPredecessor(root, run.startSequence);
    if (predecessor?.startSequence === run.startSequence) {
      if (predecessor.item === item) {
        this.assertRunEndBeforeSuccessor(predecessor, endSequence);
        return;
      }
      throw new Error(
        `Duplicate typed-run start sequence ${run.startSequence}`,
      );
    }
    if (
      predecessor !== null &&
      run.startSequence <
        predecessor.startSequence + predecessor.item.content.length
    ) {
      throw new Error(
        `Typed run ${item.id} overlaps ${predecessor.item.id} at sequence ${run.startSequence}`,
      );
    }
    const successor = findRunSuccessor(root, run.startSequence);
    if (successor !== null && endSequence > successor.startSequence) {
      throw new Error(
        `Typed run ${item.id} overlaps ${successor.item.id} at sequence ${successor.startSequence}`,
      );
    }

    const node: RunItemNode = {
      item,
      startSequence: run.startSequence,
      priority: sequencePriority(run.startSequence),
      nextStartSequence: successor?.startSequence ?? Number.POSITIVE_INFINITY,
      left: null,
      right: null,
    };
    const nextRoot = insertRunNode(root, node);
    this.runRootsByReplica.set(run.replicaId, nextRoot);
    this.runNodesByItem.set(item, node);
    if (predecessor !== null) {
      predecessor.nextStartSequence = node.startSequence;
    }
  }

  /**
   * Check an in-place typed-run extension without searching the treap.
   *
   * Registering a later range caches its start on the predecessor node, so
   * the one-character coalescing hot path can preserve the non-overlap
   * invariant in O(1), including after out-of-order replay or snapshot load.
   */
  canExtendRunItem(item: AugmentedCRDTItem, additionalLength: number): boolean {
    if (!Number.isSafeInteger(additionalLength) || additionalLength <= 0) {
      return false;
    }
    const node = this.runNodesByItem.get(item);
    if (node === undefined || item.run === null) {
      return false;
    }
    const nextEnd = node.startSequence + item.content.length + additionalLength;
    return Number.isSafeInteger(nextEnd) && nextEnd <= node.nextStartSequence;
  }

  private assertRunEndBeforeSuccessor(
    node: RunItemNode,
    endSequence: number,
  ): void {
    if (endSequence > node.nextStartSequence) {
      throw new Error(
        `Typed run ${node.item.id} overlaps the run at sequence ${node.nextStartSequence}`,
      );
    }
  }

  private findRunItem(
    replicaId: string,
    sequence: number,
  ): AugmentedCRDTItem | null {
    const node = findRunNode(
      this.runRootsByReplica.get(replicaId) ?? null,
      sequence,
    );
    return node?.item ?? null;
  }
}

const findRunNode = (
  root: RunItemNode | null,
  sequence: number,
): RunItemNode | null => {
  let node = root;
  let candidate: RunItemNode | null = null;
  while (node !== null) {
    if (node.startSequence <= sequence) {
      candidate = node;
      node = node.right;
    } else {
      node = node.left;
    }
  }
  if (
    candidate !== null &&
    sequence < candidate.startSequence + candidate.item.content.length
  ) {
    return candidate;
  }
  return null;
};

const findRunPredecessor = (
  root: RunItemNode | null,
  sequence: number,
): RunItemNode | null => {
  let node = root;
  let predecessor: RunItemNode | null = null;
  while (node !== null) {
    if (node.startSequence <= sequence) {
      predecessor = node;
      node = node.right;
    } else {
      node = node.left;
    }
  }
  return predecessor;
};

const findRunSuccessor = (
  root: RunItemNode | null,
  startSequence: number,
): RunItemNode | null => {
  let node = root;
  let successor: RunItemNode | null = null;
  while (node !== null) {
    if (node.startSequence > startSequence) {
      successor = node;
      node = node.left;
    } else {
      node = node.right;
    }
  }
  return successor;
};

const insertRunNode = (
  root: RunItemNode | null,
  node: RunItemNode,
): RunItemNode => {
  if (root === null) {
    return node;
  }
  if (node.startSequence < root.startSequence) {
    const left = insertRunNode(root.left, node);
    root.left = left;
    if (compareRunPriority(left, root) < 0) {
      return rotateRunRight(root);
    }
    return root;
  }
  if (node.startSequence > root.startSequence) {
    const right = insertRunNode(root.right, node);
    root.right = right;
    if (compareRunPriority(right, root) < 0) {
      return rotateRunLeft(root);
    }
    return root;
  }
  if (root.item === node.item) {
    return root;
  }
  throw new Error(`Duplicate typed-run start sequence ${node.startSequence}`);
};

const rotateRunLeft = (root: RunItemNode): RunItemNode => {
  const pivot = root.right;
  if (pivot === null) {
    throw new Error("Cannot rotate typed-run index left");
  }
  root.right = pivot.left;
  pivot.left = root;
  return pivot;
};

const rotateRunRight = (root: RunItemNode): RunItemNode => {
  const pivot = root.left;
  if (pivot === null) {
    throw new Error("Cannot rotate typed-run index right");
  }
  root.left = pivot.right;
  pivot.right = root;
  return pivot;
};

const compareRunPriority = (left: RunItemNode, right: RunItemNode): number =>
  left.priority !== right.priority
    ? left.priority - right.priority
    : left.startSequence - right.startSequence;

/** Stable 53-bit sequence mixer; trees remain identical across replicas. */
const sequencePriority = (sequence: number): number => {
  const low = sequence >>> 0;
  const high = Math.floor(sequence / 0x1_0000_0000) >>> 0;
  let hash = 0x811c9dc5;
  hash = Math.imul(hash ^ low, 0x01000193);
  hash = Math.imul(hash ^ high, 0x01000193);
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d);
  hash ^= hash >>> 15;
  return hash >>> 0;
};
