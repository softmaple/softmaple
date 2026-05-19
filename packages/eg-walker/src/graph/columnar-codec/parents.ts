import type { EventId, GraphEvent } from "../../types";
import { BinaryReader, BinaryWriter } from "../internals/binary-io";
import type { ParentOverride } from "./types";

export const encodeParentOverrides = (
  events: ReadonlyArray<GraphEvent>,
): ParentOverride[] =>
  events.flatMap((event, eventOffset) => {
    const defaultParents =
      eventOffset === 0 ? [] : [events[eventOffset - 1]?.id];
    const parents = Array.from(event.parentVersion);
    const usesDefault =
      parents.length === defaultParents.length &&
      parents.every((parent, index) => parent === defaultParents[index]);

    return usesDefault ? [] : [{ eventOffset, parents }];
  });

/**
 * Parent overrides are emitted in topological order, so `eventOffset` is
 * strictly increasing. We write the delta from the previous offset (the
 * first delta is from `-1`, so it's always non-negative) as an unsigned
 * varint, which is one byte for offsets that are tightly clustered.
 */
export const writeParentOverrides = (
  writer: BinaryWriter,
  overrides: ReadonlyArray<ParentOverride>,
): void => {
  writer.writeVarint(overrides.length);
  let previous = -1;
  for (const override of overrides) {
    const delta = override.eventOffset - previous - 1;
    writer.writeVarint(delta);
    writer.writeStringArray(override.parents);
    previous = override.eventOffset;
  }
};

export const readParentOverrides = (reader: BinaryReader): ParentOverride[] => {
  const length = reader.readVarint();
  const overrides: ParentOverride[] = [];
  let previous = -1;
  for (let i = 0; i < length; i++) {
    const delta = reader.readVarint();
    const eventOffset = previous + 1 + delta;
    overrides.push({
      eventOffset,
      parents: reader.readStringArray(),
    });
    previous = eventOffset;
  }
  return overrides;
};

export const decodeParents = (
  overrides: ReadonlyArray<ParentOverride>,
  ids: ReadonlyArray<EventId>,
): EventId[][] => {
  const parents = ids.map((_, index) =>
    index === 0 ? [] : [ids[index - 1] as EventId],
  );

  for (const override of overrides) {
    parents[override.eventOffset] = [...override.parents];
  }

  return parents;
};
