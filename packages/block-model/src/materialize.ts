import type { EgWalkerReplica } from "@softmaple/eg-walker";
import {
  createSequenceAnchorProjection,
  type SequenceAnchor,
  type SequenceAnchorProjection,
} from "@softmaple/eg-walker/anchors";

import {
  BLOCK_MARKER,
  BLOCK_MODEL_SCHEMA_VERSION,
  BOOTSTRAP_BLOCK_ID,
  METADATA_MARKER,
  TEXT_ESCAPE,
} from "./constants";
import type {
  Block,
  BlockAttributes,
  BlockDocument,
  BlockFieldPatch,
  BlockId,
  BlockType,
  CompleteBlockFields,
  LinkAttributes,
  MarkKind,
  MarkSpan,
  RichTextEvent,
} from "./types";
import { compareIds, DEFAULT_BLOCK_FIELDS, isReserved } from "./wire";

interface FieldAssignment {
  readonly eventId: string;
  readonly value: BlockFieldValue;
}

type BlockFieldValue = BlockType | string | number | boolean | null;
type BlockFieldName = keyof CompleteBlockFields;

interface MarkerRecord {
  readonly blockId: BlockId;
  readonly eventId: string;
  readonly position: number;
}

interface MarkerEventRecord {
  readonly blockId: BlockId;
  readonly eventId: string;
  readonly sourceBlockId: BlockId | null;
}

interface DecodedUnit {
  readonly blockId: BlockId;
  readonly from: number;
  readonly to: number;
  readonly rawFrom: number;
  readonly rawTo: number;
}

interface DecodedBoundary {
  readonly offset: number;
  readonly raw: number;
}

interface DecodedSegment {
  readonly text: string;
  readonly boundaries: ReadonlyMap<number, number>;
  readonly units: ReadonlyArray<DecodedUnit>;
}

export interface ProjectedBlock {
  readonly block: Block;
  readonly boundaries: ReadonlyMap<number, number>;
  readonly anchorBoundaries: ReadonlyArray<DecodedBoundary>;
  readonly units: ReadonlyArray<DecodedUnit>;
  readonly rawStart: number;
  readonly rawEnd: number;
}

export interface MaterializedBlockState {
  readonly document: BlockDocument;
  readonly projectedBlocks: ReadonlyArray<ProjectedBlock>;
}

interface MutableProjectedBlock {
  readonly id: BlockId;
  readonly type: BlockType;
  readonly requestedAttrs: BlockAttributes;
  text: string;
  readonly boundaries: Map<number, number>;
  readonly anchorBoundaries: DecodedBoundary[];
  readonly units: DecodedUnit[];
  readonly rawStart: number;
  rawEnd: number;
}

interface ResolvedMarkEvent {
  readonly eventId: string;
  readonly ownedBlockIds: ReadonlySet<BlockId>;
  readonly kind: MarkKind;
  readonly value: true | LinkAttributes | null;
  readonly start: number;
  readonly end: number;
}

export const materializeBlockState = (
  replica: EgWalkerReplica,
  events: ReadonlyArray<RichTextEvent>,
): MaterializedBlockState => {
  const sequenceProjection = createSequenceAnchorProjection(replica);
  const eventsById = new Map(events.map((event) => [event.id, event]));
  const parents = new Map(
    events.map((event) => [event.id, new Set(event.parentVersion)]),
  );
  const assignments = collectFieldAssignments(events);
  const removalCauses = new Map<BlockId, Set<string>>();
  const joined = new Set<BlockId>();
  const joinEvents = new Map<BlockId, string[]>();
  const markerEvents: MarkerEventRecord[] = [];
  const seenBlocks = new Set<BlockId>();

  for (const event of events) {
    const effect = event.effect;
    if (effect.type === "bootstrap" || effect.type === "block-create") {
      if (seenBlocks.has(effect.blockId)) {
        throw new Error(`Duplicate block ID ${effect.blockId}`);
      }
      seenBlocks.add(effect.blockId);
      markerEvents.push({
        blockId: effect.blockId,
        eventId: event.id,
        sourceBlockId:
          effect.type === "block-create" ? effect.sourceBlockId : null,
      });
      continue;
    }
    if (effect.type === "block-delete") {
      if (effect.blockId === BOOTSTRAP_BLOCK_ID) {
        throw new Error("The deterministic bootstrap block cannot be deleted");
      }
      const causes = removalCauses.get(effect.blockId) ?? new Set<string>();
      causes.add(event.id);
      removalCauses.set(effect.blockId, causes);
    } else if (effect.type === "block-join") {
      if (effect.blockId === BOOTSTRAP_BLOCK_ID) {
        throw new Error("The deterministic bootstrap block cannot be joined");
      }
      joined.add(effect.blockId);
      const blockJoinEvents = joinEvents.get(effect.blockId) ?? [];
      blockJoinEvents.push(event.id);
      joinEvents.set(effect.blockId, blockJoinEvents);
    }
  }

  // A remove that did not observe a split wins over that split. If the remove
  // causally follows the split, it targeted only the source block and does not
  // implicitly remove the already-known child. Propagate causes to support a
  // chain of nested/concurrent splits deterministically.
  let propagated = true;
  while (propagated) {
    propagated = false;
    for (const marker of markerEvents) {
      if (marker.sourceBlockId === null) {
        continue;
      }
      const sourceCauses = removalCauses.get(marker.sourceBlockId);
      if (sourceCauses === undefined) {
        continue;
      }
      const childCauses =
        removalCauses.get(marker.blockId) ?? new Set<string>();
      for (const removeEventId of sourceCauses) {
        if (
          !isAncestor(marker.eventId, removeEventId, parents) &&
          !childCauses.has(removeEventId)
        ) {
          childCauses.add(removeEventId);
          propagated = true;
        }
      }
      if (childCauses.size > 0) {
        removalCauses.set(marker.blockId, childCauses);
      }
    }
  }
  const removed = new Set(removalCauses.keys());
  const splitLineages = buildSplitLineages(markerEvents);

  const rawText = sequenceProjection.text;
  const markers: MarkerRecord[] = markerEvents
    .map(({ blockId, eventId }) => {
      const position = sequenceProjection.resolveAnchor(markerAnchor(eventId));
      if (rawText[position] !== BLOCK_MARKER) {
        throw new Error(`Block marker event ${eventId} is not present`);
      }
      return { blockId, eventId, position };
    })
    .sort(
      (left, right) =>
        left.position - right.position ||
        compareIds(left.eventId, right.eventId),
    );
  if (markers.length === 0 || markers[0]!.blockId !== BOOTSTRAP_BLOCK_ID) {
    throw new Error("Document is missing its deterministic bootstrap marker");
  }

  const mutableBlocks: MutableProjectedBlock[] = [];
  for (let index = 0; index < markers.length; index++) {
    const marker = markers[index]!;
    const nextMarker = markers[index + 1];
    const segmentStart = marker.position + BLOCK_MARKER.length;
    const segmentEnd = nextMarker?.position ?? rawText.length;
    const segment = decodeSegment(
      rawText,
      segmentStart,
      segmentEnd,
      marker.blockId,
    );
    if (removed.has(marker.blockId)) {
      continue;
    }
    if (joined.has(marker.blockId)) {
      const previous = mutableBlocks.at(-1);
      if (previous !== undefined) {
        appendSegment(previous, segment, segmentEnd);
      }
      continue;
    }

    const fields = resolveBlockFields(
      marker.blockId,
      assignments.get(marker.blockId),
      parents,
      eventsById,
    );
    mutableBlocks.push({
      id: marker.blockId,
      type: fields.type,
      requestedAttrs: {
        parentId: fields.parentId,
        language: fields.language,
        theme: fields.theme,
        start: fields.start,
        value: fields.value,
        checked: fields.checked,
      },
      text: segment.text,
      boundaries: new Map(segment.boundaries),
      anchorBoundaries: Array.from(segment.boundaries, ([offset, raw]) => ({
        offset,
        raw,
      })),
      units: [...segment.units],
      rawStart: segmentStart,
      rawEnd: segmentEnd,
    });
  }

  const resolvedMarks = resolveMarkEvents(
    sequenceProjection,
    events,
    markers,
    parents,
    removalCauses,
    joinEvents,
  );
  const visibleById = new Map<BlockId, BlockType>();
  const projectedBlocks = mutableBlocks.map((mutable) => {
    const attrs = normalizeOutputAttributes(
      mutable.type,
      mutable.requestedAttrs,
      visibleById,
    );
    const marks = materializeMarks(
      mutable.units,
      resolvedMarks,
      parents,
      splitLineages,
    );
    const block: Block = Object.freeze({
      id: mutable.id,
      type: mutable.type,
      text: mutable.text,
      attrs: Object.freeze(attrs),
      marks: Object.freeze(marks),
    });
    visibleById.set(block.id, block.type);
    return Object.freeze({
      block,
      boundaries: mutable.boundaries,
      anchorBoundaries: Object.freeze(
        mutable.anchorBoundaries.map((boundary) => Object.freeze(boundary)),
      ),
      units: Object.freeze([...mutable.units]),
      rawStart: mutable.rawStart,
      rawEnd: mutable.rawEnd,
    });
  });

  const document: BlockDocument = Object.freeze({
    schemaVersion: BLOCK_MODEL_SCHEMA_VERSION,
    blocks: Object.freeze(projectedBlocks.map(({ block }) => block)),
  });
  return Object.freeze({
    document,
    projectedBlocks: Object.freeze(projectedBlocks),
  });
};

const buildSplitLineages = (
  markers: ReadonlyArray<MarkerEventRecord>,
): ReadonlyMap<BlockId, ReadonlySet<BlockId>> => {
  const sourceByBlock = new Map(
    markers.map(({ blockId, sourceBlockId }) => [blockId, sourceBlockId]),
  );
  const lineages = new Map<BlockId, ReadonlySet<BlockId>>();

  for (const { blockId } of markers) {
    const lineage = new Set<BlockId>();
    let current: BlockId | null = blockId;
    while (current !== null) {
      if (lineage.has(current)) {
        throw new Error(`Cyclic split lineage at block ${current}`);
      }
      lineage.add(current);
      current = sourceByBlock.get(current) ?? null;
    }
    lineages.set(blockId, lineage);
  }

  return lineages;
};

const collectFieldAssignments = (
  events: ReadonlyArray<RichTextEvent>,
): ReadonlyMap<BlockId, ReadonlyMap<BlockFieldName, FieldAssignment[]>> => {
  const assignments = new Map<
    BlockId,
    Map<BlockFieldName, FieldAssignment[]>
  >();
  for (const event of events) {
    const effect = event.effect;
    if (effect.type === "bootstrap" || effect.type === "block-create") {
      addFields(assignments, effect.blockId, event.id, effect.fields);
    } else if (effect.type === "block-set") {
      addFields(assignments, effect.blockId, event.id, effect.fields);
    }
  }
  return assignments;
};

const addFields = (
  assignments: Map<BlockId, Map<BlockFieldName, FieldAssignment[]>>,
  blockId: BlockId,
  eventId: string,
  fields: BlockFieldPatch,
): void => {
  const byField = assignments.get(blockId) ?? new Map();
  assignments.set(blockId, byField);
  const add = (
    field: BlockFieldName,
    value: BlockFieldValue | undefined,
  ): void => {
    if (value === undefined) {
      return;
    }
    const fieldAssignments = byField.get(field) ?? [];
    fieldAssignments.push({ eventId, value });
    byField.set(field, fieldAssignments);
  };
  add("type", fields.type);
  add("parentId", fields.parentId);
  add("language", fields.language);
  add("theme", fields.theme);
  add("start", fields.start);
  add("value", fields.value);
  add("checked", fields.checked);
};

const resolveBlockFields = (
  blockId: BlockId,
  assignments: ReadonlyMap<BlockFieldName, FieldAssignment[]> | undefined,
  parents: ReadonlyMap<string, ReadonlySet<string>>,
  eventsById: ReadonlyMap<string, RichTextEvent>,
): CompleteBlockFields => {
  if (assignments === undefined) {
    throw new Error(`Block ${blockId} has no creation fields`);
  }
  const winner = (field: BlockFieldName): BlockFieldValue => {
    const candidates = assignments.get(field);
    if (candidates === undefined || candidates.length === 0) {
      return DEFAULT_BLOCK_FIELDS[field];
    }
    return selectCausalMaximal(candidates, parents, eventsById).value;
  };
  return {
    type: winner("type") as BlockType,
    parentId: winner("parentId") as string | null,
    language: winner("language") as string | null,
    theme: winner("theme") as string | null,
    start: winner("start") as number | null,
    value: winner("value") as number | null,
    checked: winner("checked") as boolean | null,
  };
};

const selectCausalMaximal = <T extends { readonly eventId: string }>(
  candidates: ReadonlyArray<T>,
  parents: ReadonlyMap<string, ReadonlySet<string>>,
  eventsById?: ReadonlyMap<string, RichTextEvent>,
): T => {
  const maxima = candidates.filter(
    (candidate) =>
      !candidates.some(
        (other) =>
          candidate.eventId !== other.eventId &&
          isAncestor(candidate.eventId, other.eventId, parents),
      ),
  );
  const winner = maxima.reduce<T | null>(
    (current, candidate) =>
      current === null || compareIds(current.eventId, candidate.eventId) < 0
        ? candidate
        : current,
    null,
  );
  if (winner === null || (eventsById && !eventsById.has(winner.eventId))) {
    throw new Error("Cannot resolve a causal LWW winner");
  }
  return winner;
};

const isAncestor = (
  ancestorId: string,
  descendantId: string,
  parents: ReadonlyMap<string, ReadonlySet<string>>,
): boolean => {
  const stack = [...(parents.get(descendantId) ?? [])];
  const visited = new Set<string>();
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current === ancestorId) {
      return true;
    }
    if (visited.has(current)) {
      continue;
    }
    visited.add(current);
    stack.push(...(parents.get(current) ?? []));
  }
  return false;
};

const decodeSegment = (
  raw: string,
  start: number,
  end: number,
  blockId: BlockId,
): DecodedSegment => {
  let text = "";
  const boundaries = new Map<number, number>([[0, start]]);
  const units: DecodedUnit[] = [];
  let rawIndex = start;
  while (rawIndex < end) {
    const current = raw[rawIndex]!;
    if (current === METADATA_MARKER) {
      rawIndex++;
      continue;
    }
    if (current === BLOCK_MARKER) {
      throw new Error("Unindexed block marker found inside a block segment");
    }
    const logicalFrom = text.length;
    const rawFrom = rawIndex;
    if (current === TEXT_ESCAPE) {
      const escaped = raw[rawIndex + 1];
      if (escaped === undefined || !isReserved(escaped)) {
        throw new Error("Malformed escaped rich-text payload");
      }
      text += escaped;
      rawIndex += 2;
    } else {
      const codePoint = raw.codePointAt(rawIndex);
      if (codePoint === undefined) {
        throw new Error("Malformed UTF-16 rich-text payload");
      }
      const visible = String.fromCodePoint(codePoint);
      text += visible;
      rawIndex += visible.length;
    }
    units.push({
      blockId,
      from: logicalFrom,
      to: text.length,
      rawFrom,
      rawTo: rawIndex,
    });
    boundaries.set(text.length, rawIndex);
  }
  return { text, boundaries, units };
};

const appendSegment = (
  target: MutableProjectedBlock,
  segment: DecodedSegment,
  rawEnd: number,
): void => {
  const logicalOffset = target.text.length;
  target.text += segment.text;
  for (const [offset, rawIndex] of segment.boundaries) {
    target.anchorBoundaries.push({
      offset: logicalOffset + offset,
      raw: rawIndex,
    });
    if (offset > 0 || !target.boundaries.has(logicalOffset)) {
      target.boundaries.set(logicalOffset + offset, rawIndex);
    }
  }
  target.units.push(
    ...segment.units.map((unit) => ({
      ...unit,
      from: logicalOffset + unit.from,
      to: logicalOffset + unit.to,
    })),
  );
  target.rawEnd = rawEnd;
};

const resolveMarkEvents = (
  projection: SequenceAnchorProjection,
  events: ReadonlyArray<RichTextEvent>,
  markers: ReadonlyArray<MarkerRecord>,
  parents: ReadonlyMap<string, ReadonlySet<string>>,
  removalCauses: ReadonlyMap<BlockId, ReadonlySet<string>>,
  joinEvents: ReadonlyMap<BlockId, ReadonlyArray<string>>,
): ReadonlyArray<ResolvedMarkEvent> =>
  events.flatMap((event): ResolvedMarkEvent[] => {
    if (event.effect.type !== "mark-set") {
      return [];
    }
    const start = projection.resolveAnchor(event.effect.range.start);
    const end = projection.resolveAnchor(event.effect.range.end);
    if (start >= end) {
      return [];
    }
    return [
      {
        eventId: event.id,
        ownedBlockIds:
          joinEvents.size === 0
            ? new Set([event.effect.blockId])
            : resolveMarkOwnership(
                event.effect.blockId,
                collectAncestors(event.id, parents),
                markers,
                removalCauses,
                joinEvents,
              ),
        kind: event.effect.kind,
        value: event.effect.value,
        start,
        end,
      },
    ];
  });

const collectAncestors = (
  eventId: string,
  parents: ReadonlyMap<string, ReadonlySet<string>>,
): ReadonlySet<string> => {
  const ancestors = new Set<string>();
  const stack = [...(parents.get(eventId) ?? [])];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (ancestors.has(current)) {
      continue;
    }
    ancestors.add(current);
    stack.push(...(parents.get(current) ?? []));
  }
  return ancestors;
};

/**
 * Recover the visible block group that owned a mark range when it was set.
 * Joined segments retain their originating IDs so older marks survive future
 * joins, while a mark created after a join can still address the merged text.
 */
const resolveMarkOwnership = (
  blockId: BlockId,
  observedEventIds: ReadonlySet<string>,
  markers: ReadonlyArray<MarkerRecord>,
  removalCauses: ReadonlyMap<BlockId, ReadonlySet<string>>,
  joinEvents: ReadonlyMap<BlockId, ReadonlyArray<string>>,
): ReadonlySet<BlockId> => {
  let visibleOwner: BlockId | null = null;
  const ownedBlockIds = new Set<BlockId>();

  for (const marker of markers) {
    if (!observedEventIds.has(marker.eventId)) {
      continue;
    }
    const blockRemovalCauses = removalCauses.get(marker.blockId);
    const removed =
      blockRemovalCauses !== undefined &&
      setsIntersect(blockRemovalCauses, observedEventIds);
    if (removed) {
      continue;
    }
    const joinedBeforeMark = (joinEvents.get(marker.blockId) ?? []).some(
      (eventId) => observedEventIds.has(eventId),
    );
    if (!joinedBeforeMark || visibleOwner === null) {
      visibleOwner = marker.blockId;
    }
    if (visibleOwner === blockId) {
      ownedBlockIds.add(marker.blockId);
    }
  }

  // Unknown block IDs remain harmless no-ops, matching the previous lineage
  // gate while keeping the declared owner available for split descendants.
  if (ownedBlockIds.size === 0) {
    ownedBlockIds.add(blockId);
  }
  return ownedBlockIds;
};

const materializeMarks = (
  units: ReadonlyArray<DecodedUnit>,
  markEvents: ReadonlyArray<ResolvedMarkEvent>,
  parents: ReadonlyMap<string, ReadonlySet<string>>,
  splitLineages: ReadonlyMap<BlockId, ReadonlySet<BlockId>>,
): MarkSpan[] => {
  const spans: MarkSpan[] = [];
  for (const kind of [
    "bold",
    "italic",
    "underline",
    "strike",
    "inline-code",
    "link",
  ] as const) {
    for (const unit of units) {
      const candidates = markEvents.filter((event) => {
        const lineage = splitLineages.get(unit.blockId);
        return (
          event.kind === kind &&
          lineage !== undefined &&
          setsIntersect(lineage, event.ownedBlockIds) &&
          event.start <= unit.rawFrom &&
          unit.rawTo <= event.end
        );
      });
      if (candidates.length === 0) {
        continue;
      }
      const winner = selectCausalMaximal(candidates, parents);
      if (winner.value === null) {
        continue;
      }
      const previous = spans.at(-1);
      if (
        previous?.kind === kind &&
        previous.to === unit.from &&
        sameMarkValue(previous.value, winner.value)
      ) {
        spans[spans.length - 1] = {
          ...previous,
          to: unit.to,
        };
      } else {
        spans.push({
          kind,
          from: unit.from,
          to: unit.to,
          value: winner.value,
        });
      }
    }
  }
  return spans.sort(
    (left, right) =>
      left.from - right.from ||
      left.to - right.to ||
      compareIds(left.kind, right.kind),
  );
};

const setsIntersect = <T>(
  left: ReadonlySet<T>,
  right: ReadonlySet<T>,
): boolean => {
  for (const value of left) {
    if (right.has(value)) {
      return true;
    }
  }
  return false;
};

const sameMarkValue = (
  left: true | LinkAttributes,
  right: true | LinkAttributes,
): boolean => JSON.stringify(left) === JSON.stringify(right);

const normalizeOutputAttributes = (
  type: BlockType,
  requested: BlockAttributes,
  previousBlocks: ReadonlyMap<BlockId, BlockType>,
): BlockAttributes => {
  const list = isListType(type);
  const requestedParentType =
    requested.parentId === null
      ? undefined
      : previousBlocks.get(requested.parentId);
  const parentId =
    list && requested.parentId !== null && isListType(requestedParentType)
      ? requested.parentId
      : null;
  return {
    parentId,
    language: type === "code" ? requested.language : null,
    theme: type === "code" ? requested.theme : null,
    start: type === "number-list" ? requested.start : null,
    value: type === "number-list" ? requested.value : null,
    checked: type === "check-list" ? requested.checked : null,
  };
};

const isListType = (type: BlockType | undefined): boolean =>
  type === "bullet-list" || type === "number-list" || type === "check-list";

const markerAnchor = (eventId: string): SequenceAnchor => ({
  type: "atom",
  eventId,
  offset: 0,
  affinity: "before",
});
