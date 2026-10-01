import type { EventId, GraphEvent } from "../../types";
import type { BinaryReader } from "../internals/binary-io";
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
 * Read EGW3 parent overrides. Their `eventOffset`s are strictly increasing,
 * so each is written as the gap after the previous one (the first after
 * `-1`), followed by the parent IDs as strings.
 */
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
