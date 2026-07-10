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
          originRight =
            candidate.originLeft === originLeft ? candidate.id : null;
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
    } else {
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
    }
    currentVersion = new Set([event.id]);
  }

  return items
    .filter(({ deleted }) => !deleted)
    .map(({ content }) => content)
    .join("");
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
  const leftIndex = cursor - 1;
  const rightIndex =
    item.originRight === null
      ? items.length
      : requireItemIndex(items, item.originRight);
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
      other.originLeft === null
        ? -1
        : requireItemIndex(items, other.originLeft);
    if (otherLeft < leftIndex) break;
    if (otherLeft === leftIndex) {
      const otherRight =
        other.originRight === null
          ? items.length
          : requireItemIndex(items, other.originRight);
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

const requireItemIndex = (
  items: ReadonlyArray<ScalarItem>,
  id: EventId,
): number => {
  const index = items.findIndex((item) => item.id === id);
  if (index === -1) throw new Error(`Scalar reference missing item ${id}`);
  return index;
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
