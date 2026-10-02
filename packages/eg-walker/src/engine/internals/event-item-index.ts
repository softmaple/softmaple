import type { AugmentedCRDTItem, ItemKey } from "./engine-types";

type StoredEventItems = ItemKey | ItemKey[];
export type EventItems = ItemKey | ReadonlyArray<ItemKey>;

/** Canonical `(agent, sequence)` of an event, or a negative agent. */
export interface EventIdentityResolver {
  agentAt(localVersion: number): number;
  sequenceAt(localVersion: number): number;
}

/**
 * Treap node of one typed-run record. The record also points at it, through
 * {@link AugmentedCRDTItem.runNode}, in place of a side table keyed by the
 * record.
 */
export interface RunItemNode {
  readonly item: AugmentedCRDTItem;
  /** Lifetime of the index that created the node. */
  readonly epoch: number;
  readonly startSequence: number;
  readonly priority: number;
  nextStartSequence: number;
  left: RunItemNode | null;
  right: RunItemNode | null;
}

/**
 * Every index lifetime takes its number from this one counter, so a run node
 * of a cleared or a different index never matches the current lifetime.
 */
let lastRunIndexEpoch = 0;
const nextRunIndexEpoch = (): number => ++lastRunIndexEpoch;

/**
 * Event -> CRDT item lookup used by retreat / advance.
 *
 * Insert events that are not part of a typed run keep direct entries, keyed
 * by the event's local version. A multi-character insert starts as one
 * insert-run record, and every split of that record adds its right half to
 * the same entry, so one event can own multiple CRDT items.
 * Coalesced typed-run records are cheaper: a record spans a contiguous
 * `(agent, sequence)` range, so replay and snapshot restore register the
 * range once instead of one entry per character event. Each agent's ranges
 * live in a deterministic treap, keeping arbitrary split/lookup order
 * logarithmic.
 */
export class EventItemIndex {
  private readonly direct = new Map<number, StoredEventItems>();
  /**
   * Owning event of each insert-run record that can still be split: one
   * holding more than one code unit when it was registered, or a split's
   * right half.
   */
  private readonly fragmentOwners = new Map<ItemKey, number>();
  private runRootsByAgent: Array<RunItemNode | undefined> = [];
  /** Lifetime of the run treaps; {@link clear} starts a new one. */
  private epoch = nextRunIndexEpoch();

  constructor(private readonly events: EventIdentityResolver) {}

  clear(): void {
    this.direct.clear();
    this.fragmentOwners.clear();
    this.runRootsByAgent = [];
    this.epoch = nextRunIndexEpoch();
  }

  set(localVersion: number, itemIds: ItemKey[]): void {
    this.direct.set(localVersion, itemIds.length === 1 ? itemIds[0]! : itemIds);
  }

  /** Store the dominant one-event/one-record case without a wrapper array. */
  setOne(localVersion: number, itemId: ItemKey): void {
    this.direct.set(localVersion, itemId);
  }

  add(localVersion: number, itemId: ItemKey): void {
    const items = this.direct.get(localVersion);
    if (items === undefined) {
      this.direct.set(localVersion, itemId);
      return;
    }
    if (typeof items !== "number") {
      items.push(itemId);
      return;
    }
    this.direct.set(localVersion, [items, itemId]);
  }

  /**
   * Register the single insert-run record of a multi-character insert. A
   * later split adds its right half to the same entry through
   * {@link addSplitFragment}.
   */
  setInsertRun(localVersion: number, itemId: ItemKey): void {
    this.direct.set(localVersion, itemId);
    this.fragmentOwners.set(itemId, localVersion);
  }

  /** Add a restored insert-run record that holds more than one code unit. */
  addInsertRun(localVersion: number, itemId: ItemKey): void {
    this.add(localVersion, itemId);
    this.fragmentOwners.set(itemId, localVersion);
  }

  /**
   * Register `right`, split off insert-run record `left`, under the event
   * that owns `left`. A record the index does not own stays unregistered:
   * it belongs to an event outside the replay graph, which no retreat or
   * advance names.
   */
  addSplitFragment(left: ItemKey, right: ItemKey): void {
    const localVersion = this.fragmentOwners.get(left);
    if (localVersion === undefined) {
      return;
    }
    this.add(localVersion, right);
    this.fragmentOwners.set(right, localVersion);
  }

  /**
   * Resolve to a scalar for one-record events and an array only when the
   * event genuinely owns multiple records. Callers must treat returned arrays
   * as read-only; avoiding a scalar wrapper is load-bearing on replay diffs.
   */
  get(localVersion: number): EventItems | undefined {
    const direct = this.direct.get(localVersion);
    if (direct !== undefined) {
      return direct;
    }

    const agent = this.events.agentAt(localVersion);
    if (agent < 0) {
      return undefined;
    }
    const item = this.findRunItem(agent, this.events.sequenceAt(localVersion));
    return item?.id;
  }

  /** Whether an event has direct (non-run) item entries. */
  hasDirect(localVersion: number): boolean {
    return this.direct.has(localVersion);
  }

  /** Resolve a canonical scalar event without resolving its local version. */
  getRunItem(agent: number, sequence: number): AugmentedCRDTItem | undefined {
    return this.findRunItem(agent, sequence) ?? undefined;
  }

  registerRunItem(item: AugmentedCRDTItem): void {
    if (!item.run) {
      return;
    }
    if (item.content.length <= 0) {
      throw new Error(`Typed run ${item.id} must have positive length`);
    }
    const startSequence = item.sequence;
    const endSequence = startSequence + item.content.length;
    if (!Number.isSafeInteger(endSequence)) {
      throw new Error(`Typed run ${item.id} exceeds the safe sequence range`);
    }

    const root = this.runRootsByAgent[item.agent] ?? null;
    const predecessor = findRunPredecessor(root, startSequence);
    if (predecessor?.startSequence === startSequence) {
      if (predecessor.item === item) {
        this.assertRunEndBeforeSuccessor(predecessor, endSequence);
        return;
      }
      throw new Error(`Duplicate typed-run start sequence ${startSequence}`);
    }
    if (
      predecessor !== null &&
      startSequence <
        predecessor.startSequence + predecessor.item.content.length
    ) {
      throw new Error(
        `Typed run ${item.id} overlaps ${predecessor.item.id} at sequence ${startSequence}`,
      );
    }
    const successor = findRunSuccessor(root, startSequence);
    if (successor !== null && endSequence > successor.startSequence) {
      throw new Error(
        `Typed run ${item.id} overlaps ${successor.item.id} at sequence ${successor.startSequence}`,
      );
    }

    const node: RunItemNode = {
      item,
      epoch: this.epoch,
      startSequence,
      priority: sequencePriority(startSequence),
      nextStartSequence: successor?.startSequence ?? Number.POSITIVE_INFINITY,
      left: null,
      right: null,
    };
    this.runRootsByAgent[item.agent] = insertRunNode(root, node);
    item.runNode = node;
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
    const node = item.runNode;
    if (node === null || node.epoch !== this.epoch || !item.run) {
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
    agent: number,
    sequence: number,
  ): AugmentedCRDTItem | null {
    const node = findRunNode(this.runRootsByAgent[agent] ?? null, sequence);
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
