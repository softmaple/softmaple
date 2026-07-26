import { OPERATION_TYPE } from "../constants/operation-types";
import type { EventId, GraphEvent, Version } from "../types";

interface ScalarItem {
  readonly id: EventId;
  readonly eventId: EventId;
  readonly content: string;
  readonly originRight: EventId | null;
  originLeft: EventId | null;
  prepareState: number;
  deleted: boolean;
}

/**
 * Deliberately scalar, array-backed replay used only as a conformance oracle.
 * It shares no engine, ranked-tree, Fugue-index, or EventGraph code with the
 * implementation under test.
 */
export const materializeScalarReferenceVersion = (
  allEvents: ReadonlyArray<GraphEvent>,
  version: Version,
  initialText: string = "",
): string => {
  const eventById = strictEventMap(allEvents);
  const included = causalClosure(version, eventById);
  const events = referenceTopologicalOrder(
    allEvents.filter(({ id }) => included.has(id)),
  );
  if (isLinearChain(events)) {
    return materializeLinearChain(events, initialText);
  }
  const rank = new Map(events.map(({ id }, index) => [id, index]));
  const items = seedItems(initialText);
  const itemsById = new Map(items.map((item) => [item.id, item]));
  const deleteTargets = new Map<EventId, EventId>();
  let currentVersion = new Set<EventId>();

  const expand = (frontier: Version): Set<EventId> =>
    causalClosure(frontier, eventById);
  const transitionTo = (target: Version): void => {
    const current = expand(currentVersion);
    const next = expand(target);
    const retreat = [...current]
      .filter((id) => !next.has(id))
      .sort((left, right) => (rank.get(right) ?? -1) - (rank.get(left) ?? -1));
    const advance = [...next]
      .filter((id) => !current.has(id))
      .sort((left, right) => (rank.get(left) ?? -1) - (rank.get(right) ?? -1));
    for (const id of retreat) {
      togglePrepareState(id, -1, eventById, itemsById, deleteTargets);
    }
    for (const id of advance) {
      togglePrepareState(id, 1, eventById, itemsById, deleteTargets);
    }
  };

  for (const event of events) {
    transitionTo(event.parentVersion);
    applyScalarReferenceEvent(event, items, itemsById, deleteTargets);
    currentVersion = new Set([event.id]);
  }

  return items
    .filter(({ deleted }) => !deleted)
    .map(({ content }) => content)
    .join("");
};

export interface ScalarReferenceSessionStats {
  readonly eventsApplied: number;
  readonly versionTransitions: number;
  readonly versionDiffVisits: number;
}

/**
 * Stateful form of the independent scalar oracle.
 *
 * Paper trace conversion asks for many parent-version documents. Rebuilding
 * the scalar oracle from event zero for every merge is quadratic, so this
 * session retains scalar items and moves only across each version diff. It
 * deliberately shares no EventGraph, EgWalkerEngine, Fugue index, or ranked
 * sequence implementation with the production algorithm.
 */
export class ScalarReferenceSession {
  private readonly events = new Map<EventId, GraphEvent>();
  private readonly rank = new Map<EventId, number>();
  private readonly items: ScalarItem[];
  private readonly itemsById: Map<EventId, ScalarItem>;
  private readonly deleteTargets = new Map<EventId, EventId>();
  private currentVersion = new Set<EventId>();
  private eventsApplied = 0;
  private versionTransitions = 0;
  private versionDiffVisits = 0;

  constructor(initialText: string = "") {
    this.items = seedItems(initialText);
    this.itemsById = new Map(this.items.map((item) => [item.id, item]));
  }

  applyEvent(event: GraphEvent): void {
    if (this.events.has(event.id)) {
      throw new Error(`Duplicate event ${event.id}`);
    }
    for (const parentId of event.parentVersion) {
      if (!this.events.has(parentId)) {
        throw new Error(`Unknown scalar reference event ${parentId}`);
      }
    }

    this.transitionTo(event.parentVersion);
    applyScalarReferenceEvent(
      event,
      this.items,
      this.itemsById,
      this.deleteTargets,
    );
    this.events.set(event.id, event);
    this.rank.set(event.id, this.rank.size);
    this.currentVersion = new Set([event.id]);
    this.eventsApplied++;
  }

  transitionTo(version: Version): void {
    if (versionsEqual(this.currentVersion, version)) {
      return;
    }
    const diff = referenceVersionDiff(
      this.currentVersion,
      version,
      this.events,
      this.rank,
    );
    const retreat = [...diff.onlyInLeft].sort(
      (left, right) =>
        (this.rank.get(right) ?? -1) - (this.rank.get(left) ?? -1),
    );
    const advance = [...diff.onlyInRight].sort(
      (left, right) =>
        (this.rank.get(left) ?? -1) - (this.rank.get(right) ?? -1),
    );
    for (const eventId of retreat) {
      togglePrepareState(
        eventId,
        -1,
        this.events,
        this.itemsById,
        this.deleteTargets,
      );
    }
    for (const eventId of advance) {
      togglePrepareState(
        eventId,
        1,
        this.events,
        this.itemsById,
        this.deleteTargets,
      );
    }
    this.currentVersion = new Set(version);
    this.versionTransitions++;
    this.versionDiffVisits += diff.visits;
  }

  getPrepareText(): string {
    return this.items
      .filter(({ prepareState }) => prepareState === 1)
      .map(({ content }) => content)
      .join("");
  }

  materializeVersion(version: Version): string {
    this.transitionTo(version);
    return this.getPrepareText();
  }

  getStats(): ScalarReferenceSessionStats {
    return {
      eventsApplied: this.eventsApplied,
      versionTransitions: this.versionTransitions,
      versionDiffVisits: this.versionDiffVisits,
    };
  }
}

const applyScalarReferenceEvent = (
  event: GraphEvent,
  items: ScalarItem[],
  itemsById: Map<EventId, ScalarItem>,
  deleteTargets: Map<EventId, EventId>,
): void => {
  if (event.operation.type === OPERATION_TYPE.INSERT) {
    const scalars = Array.from(event.operation.text);
    if (scalars.length !== 1) {
      throw new Error(
        `Scalar reference event ${event.id} must insert exactly one Unicode scalar`,
      );
    }
    const cursor = findPrepareCursor(items, event.operation.index);
    const originLeft = cursor === 0 ? null : items[cursor - 1]!.id;
    let originRight: EventId | null = null;
    for (let index = cursor; index < items.length; index++) {
      const candidate = items[index]!;
      if (candidate.prepareState !== 0) {
        originRight = candidate.originLeft === originLeft ? candidate.id : null;
        break;
      }
    }
    const item: ScalarItem = {
      id: event.id,
      eventId: event.id,
      content: scalars[0]!,
      originLeft,
      originRight,
      prepareState: 1,
      deleted: false,
    };
    const position = referenceIntegrationPosition(item, cursor, items);
    items.splice(position, 0, item);
    itemsById.set(item.id, item);
    return;
  }

  let cursor = findPrepareCursor(items, event.operation.index);
  while (cursor < items.length && items[cursor]!.prepareState !== 1) {
    cursor++;
  }
  const target = items[cursor];
  if (
    target === undefined ||
    target.content.length !== event.operation.length
  ) {
    throw new Error(
      `Scalar reference delete ${event.id} does not target one scalar`,
    );
  }
  target.prepareState++;
  target.deleted = true;
  deleteTargets.set(event.id, target.id);
};

interface ScalarTextNode {
  readonly content: string;
  readonly priority: number;
  left: ScalarTextNode | null;
  right: ScalarTextNode | null;
  utf16Length: number;
}

const isLinearChain = (events: ReadonlyArray<GraphEvent>): boolean => {
  let parent: EventId | null = null;
  for (const event of events) {
    if (
      event.parentVersion.size !== (parent === null ? 0 : 1) ||
      (parent !== null && !event.parentVersion.has(parent))
    ) {
      return false;
    }
    parent = event.id;
  }
  return true;
};

const materializeLinearChain = (
  events: ReadonlyArray<GraphEvent>,
  initialText: string,
): string => {
  let root: ScalarTextNode | null = null;
  for (const [index, scalar] of Array.from(initialText).entries()) {
    root = mergeTextNodes(
      root,
      createTextNode(scalar, `__paper_initial__:${index}`),
    );
  }
  for (const event of events) {
    const operation = event.operation;
    const [left, after] = splitTextNode(root, operation.index);
    if (operation.type === OPERATION_TYPE.INSERT) {
      const scalars = Array.from(operation.text);
      if (scalars.length !== 1) {
        throw new Error(
          `Scalar reference event ${event.id} must insert exactly one Unicode scalar`,
        );
      }
      root = mergeTextNodes(
        mergeTextNodes(left, createTextNode(scalars[0]!, event.id)),
        after,
      );
      continue;
    }
    const [removed, right] = splitTextNode(after, operation.length);
    if (textLength(removed) !== operation.length) {
      throw new Error(`Scalar reference delete ${event.id} is out of range`);
    }
    root = mergeTextNodes(left, right);
  }
  const output: string[] = [];
  const stack: ScalarTextNode[] = [];
  let current = root;
  while (current !== null || stack.length > 0) {
    while (current !== null) {
      stack.push(current);
      current = current.left;
    }
    current = stack.pop()!;
    output.push(current.content);
    current = current.right;
  }
  return output.join("");
};

const createTextNode = (content: string, id: EventId): ScalarTextNode => ({
  content,
  priority: stableReferencePriority(id),
  left: null,
  right: null,
  utf16Length: content.length,
});

const textLength = (node: ScalarTextNode | null): number =>
  node?.utf16Length ?? 0;

const updateTextNode = (node: ScalarTextNode): void => {
  node.utf16Length =
    textLength(node.left) + node.content.length + textLength(node.right);
};

const mergeTextNodes = (
  left: ScalarTextNode | null,
  right: ScalarTextNode | null,
): ScalarTextNode | null => {
  if (left === null) return right;
  if (right === null) return left;
  if (left.priority >= right.priority) {
    left.right = mergeTextNodes(left.right, right);
    updateTextNode(left);
    return left;
  }
  right.left = mergeTextNodes(left, right.left);
  updateTextNode(right);
  return right;
};

const splitTextNode = (
  node: ScalarTextNode | null,
  utf16Index: number,
): readonly [ScalarTextNode | null, ScalarTextNode | null] => {
  if (!Number.isSafeInteger(utf16Index) || utf16Index < 0) {
    throw new Error(`Invalid scalar reference UTF-16 index ${utf16Index}`);
  }
  if (node === null) {
    if (utf16Index === 0) return [null, null];
    throw new Error(`Scalar reference index ${utf16Index} exceeds parent text`);
  }
  const leftLength = textLength(node.left);
  if (utf16Index < leftLength) {
    const [left, remainder] = splitTextNode(node.left, utf16Index);
    node.left = remainder;
    updateTextNode(node);
    return [left, node];
  }
  const afterContent = leftLength + node.content.length;
  if (utf16Index > afterContent) {
    const [prefix, right] = splitTextNode(
      node.right,
      utf16Index - afterContent,
    );
    node.right = prefix;
    updateTextNode(node);
    return [node, right];
  }
  if (utf16Index === leftLength) {
    const left = node.left;
    node.left = null;
    updateTextNode(node);
    return [left, node];
  }
  if (utf16Index === afterContent) {
    const right = node.right;
    node.right = null;
    updateTextNode(node);
    return [node, right];
  }
  throw new Error(
    `Scalar reference index ${utf16Index} splits a Unicode scalar`,
  );
};

const stableReferencePriority = (id: EventId): number => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < id.length; index++) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
};

export const scalarReferenceFrontier = (
  events: ReadonlyArray<GraphEvent>,
): Set<EventId> => {
  const frontier = new Set(events.map(({ id }) => id));
  for (const event of events) {
    for (const parent of event.parentVersion) frontier.delete(parent);
  }
  return frontier;
};

const seedItems = (text: string): ScalarItem[] => {
  const items: ScalarItem[] = [];
  let previous: EventId | null = null;
  for (const [index, content] of Array.from(text).entries()) {
    const id = `__paper_initial__:${index}`;
    items.push({
      id,
      eventId: id,
      content,
      originLeft: previous,
      originRight: null,
      prepareState: 1,
      deleted: false,
    });
    previous = id;
  }
  return items;
};

const findPrepareCursor = (
  items: ReadonlyArray<ScalarItem>,
  target: number,
): number => {
  if (!Number.isSafeInteger(target) || target < 0) {
    throw new Error(`Invalid scalar reference UTF-16 index ${target}`);
  }
  let width = 0;
  let index = 0;
  while (width < target) {
    const item = items[index];
    if (item === undefined) {
      throw new Error(`Scalar reference index ${target} exceeds parent text`);
    }
    if (item.prepareState === 1) width += item.content.length;
    index++;
  }
  if (width !== target) {
    throw new Error(`Scalar reference index ${target} splits a Unicode scalar`);
  }
  return index;
};

const referenceIntegrationPosition = (
  item: ScalarItem,
  cursor: number,
  items: ReadonlyArray<ScalarItem>,
): number => {
  let itemIndexes: ReadonlyMap<EventId, number> | null = null;
  const indexFor = (id: EventId): number => {
    itemIndexes ??= new Map(
      items.map((candidate, index) => [candidate.id, index]),
    );
    const index = itemIndexes.get(id);
    if (index === undefined) {
      throw new Error(`Scalar reference missing item ${id}`);
    }
    return index;
  };
  const leftIndex = cursor - 1;
  const rightIndex =
    item.originRight === null ? items.length : indexFor(item.originRight);
  let insertion = cursor;
  let scan = cursor;
  let candidate = cursor;
  let scanning = false;

  while (scan < items.length) {
    const other = items[scan]!;
    if (other.prepareState !== 0) break;
    if (other.id === item.originRight) {
      throw new Error("Scalar reference encountered its right anchor early");
    }
    const otherLeft =
      other.originLeft === null ? -1 : indexFor(other.originLeft);
    if (otherLeft < leftIndex) break;
    if (otherLeft === leftIndex) {
      const otherRight =
        other.originRight === null ? items.length : indexFor(other.originRight);
      if (
        otherRight === rightIndex &&
        compareReferenceEventIds(item.eventId, other.eventId) < 0
      ) {
        break;
      }
      if (otherRight < rightIndex) {
        if (!scanning) candidate = scan;
        scanning = true;
      } else {
        scanning = false;
      }
    }
    scan++;
    if (!scanning) insertion = scan;
  }
  return scanning ? candidate : insertion;
};

const togglePrepareState = (
  eventId: EventId,
  delta: -1 | 1,
  events: ReadonlyMap<EventId, GraphEvent>,
  items: ReadonlyMap<EventId, ScalarItem>,
  deleteTargets: ReadonlyMap<EventId, EventId>,
): void => {
  const event = events.get(eventId);
  if (event === undefined)
    throw new Error(`Scalar reference missing ${eventId}`);
  const targetId =
    event.operation.type === OPERATION_TYPE.INSERT
      ? eventId
      : deleteTargets.get(eventId);
  const target = targetId === undefined ? undefined : items.get(targetId);
  if (target === undefined) {
    throw new Error(`Scalar reference missing target for ${eventId}`);
  }
  target.prepareState += delta;
};

const causalClosure = (
  version: Version,
  events: ReadonlyMap<EventId, GraphEvent>,
): Set<EventId> => {
  const result = new Set<EventId>();
  const stack = [...version];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (result.has(id)) continue;
    const event = events.get(id);
    if (event === undefined)
      throw new Error(`Unknown scalar reference event ${id}`);
    result.add(id);
    stack.push(...event.parentVersion);
  }
  return result;
};

interface ReferenceVersionDiff {
  readonly onlyInLeft: Set<EventId>;
  readonly onlyInRight: Set<EventId>;
  readonly visits: number;
}

const REFERENCE_DIFF_COLOR = {
  LEFT: 1,
  RIGHT: 2,
  COMMON: 3,
} as const;

/** Independent merge-base walk, differential-tested against causalClosure. */
const referenceVersionDiff = (
  left: Version,
  right: Version,
  events: ReadonlyMap<EventId, GraphEvent>,
  rank: ReadonlyMap<EventId, number>,
): ReferenceVersionDiff => {
  const onlyInLeft = new Set<EventId>();
  const onlyInRight = new Set<EventId>();
  const colors = new Map<EventId, number>();
  const heap = new ReferenceEventHeap(rank);
  let pendingDivergent = 0;
  let visits = 0;

  const paint = (eventId: EventId, addedColor: number): void => {
    if (!events.has(eventId)) {
      throw new Error(`Unknown scalar reference event ${eventId}`);
    }
    const existing = colors.get(eventId) ?? 0;
    const merged = existing | addedColor;
    if (merged === existing) {
      return;
    }
    colors.set(eventId, merged);
    if (existing === 0) {
      heap.push(eventId);
      if (merged !== REFERENCE_DIFF_COLOR.COMMON) {
        pendingDivergent++;
      }
    } else if (
      existing !== REFERENCE_DIFF_COLOR.COMMON &&
      merged === REFERENCE_DIFF_COLOR.COMMON
    ) {
      pendingDivergent--;
    }
  };

  for (const eventId of left) {
    paint(eventId, REFERENCE_DIFF_COLOR.LEFT);
  }
  for (const eventId of right) {
    paint(eventId, REFERENCE_DIFF_COLOR.RIGHT);
  }

  while (heap.size > 0 && pendingDivergent > 0) {
    const eventId = heap.pop()!;
    const color = colors.get(eventId) ?? 0;
    visits++;
    if (color === REFERENCE_DIFF_COLOR.LEFT) {
      onlyInLeft.add(eventId);
      pendingDivergent--;
    } else if (color === REFERENCE_DIFF_COLOR.RIGHT) {
      onlyInRight.add(eventId);
      pendingDivergent--;
    }
    for (const parentId of events.get(eventId)!.parentVersion) {
      paint(parentId, color);
    }
  }

  return { onlyInLeft, onlyInRight, visits };
};

class ReferenceEventHeap {
  private readonly values: EventId[] = [];

  constructor(private readonly rank: ReadonlyMap<EventId, number>) {}

  get size(): number {
    return this.values.length;
  }

  push(eventId: EventId): void {
    this.values.push(eventId);
    let index = this.values.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (!this.isHigher(index, parent)) {
        break;
      }
      this.swap(index, parent);
      index = parent;
    }
  }

  pop(): EventId | undefined {
    const top = this.values[0];
    const last = this.values.pop();
    if (top === undefined || last === undefined || this.values.length === 0) {
      return top;
    }
    this.values[0] = last;
    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      let highest = index;
      if (left < this.values.length && this.isHigher(left, highest)) {
        highest = left;
      }
      if (right < this.values.length && this.isHigher(right, highest)) {
        highest = right;
      }
      if (highest === index) {
        break;
      }
      this.swap(index, highest);
      index = highest;
    }
    return top;
  }

  private isHigher(leftIndex: number, rightIndex: number): boolean {
    const left = this.values[leftIndex]!;
    const right = this.values[rightIndex]!;
    const rankDelta =
      (this.rank.get(left) ?? -1) - (this.rank.get(right) ?? -1);
    return rankDelta === 0
      ? compareReferenceEventIds(left, right) > 0
      : rankDelta > 0;
  }

  private swap(left: number, right: number): void {
    [this.values[left], this.values[right]] = [
      this.values[right]!,
      this.values[left]!,
    ];
  }
}

const versionsEqual = (left: Version, right: Version): boolean => {
  if (left.size !== right.size) {
    return false;
  }
  for (const eventId of left) {
    if (!right.has(eventId)) {
      return false;
    }
  }
  return true;
};

const strictEventMap = (
  events: ReadonlyArray<GraphEvent>,
): Map<EventId, GraphEvent> => {
  const result = new Map<EventId, GraphEvent>();
  for (const event of events) {
    if (result.has(event.id)) throw new Error(`Duplicate event ${event.id}`);
    result.set(event.id, event);
  }
  return result;
};

const referenceTopologicalOrder = (
  events: ReadonlyArray<GraphEvent>,
): GraphEvent[] => {
  const map = strictEventMap(events);
  const remaining = new Map<EventId, number>();
  const children = new Map<EventId, EventId[]>();
  for (const event of events) {
    let count = 0;
    for (const parent of event.parentVersion) {
      if (!map.has(parent)) continue;
      count++;
      const list = children.get(parent) ?? [];
      list.push(event.id);
      children.set(parent, list);
    }
    remaining.set(event.id, count);
  }
  const ready = events
    .filter(({ id }) => remaining.get(id) === 0)
    .map(({ id }) => id)
    .sort(compareReferenceEventIds);
  const result: GraphEvent[] = [];
  while (ready.length > 0) {
    const id = ready.shift()!;
    result.push(map.get(id)!);
    for (const child of children.get(id) ?? []) {
      const count = (remaining.get(child) ?? 0) - 1;
      remaining.set(child, count);
      if (count === 0) {
        ready.push(child);
        ready.sort(compareReferenceEventIds);
      }
    }
  }
  if (result.length !== events.length) {
    throw new Error("Scalar reference graph contains a cycle");
  }
  return result;
};

const NUMERIC_SUFFIX = /^(0|[1-9]\d*)$/;

const compareReferenceEventIds = (left: EventId, right: EventId): number => {
  if (left === right) return 0;
  const parse = (id: EventId): readonly [string, number] | null => {
    const separator = id.lastIndexOf(":");
    const suffix = id.slice(separator + 1);
    const sequence = Number(suffix);
    return separator > 0 &&
      NUMERIC_SUFFIX.test(suffix) &&
      Number.isSafeInteger(sequence)
      ? [id.slice(0, separator), sequence]
      : null;
  };
  const leftParsed = parse(left);
  const rightParsed = parse(right);
  if (leftParsed !== null && rightParsed !== null) {
    return leftParsed[0] === rightParsed[0]
      ? Math.sign(leftParsed[1] - rightParsed[1])
      : leftParsed[0] < rightParsed[0]
        ? -1
        : 1;
  }
  if (leftParsed !== null) return -1;
  if (rightParsed !== null) return 1;
  return left < right ? -1 : 1;
};
