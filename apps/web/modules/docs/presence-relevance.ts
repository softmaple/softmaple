import {
  isDirectionalSelectionRange,
  type PresenceUser,
} from "@softmaple/awareness";

export const presenceBlock = (person: PresenceUser): string | undefined =>
  isDirectionalSelectionRange(person.selection)
    ? person.selection.focus.blockId
    : person.cursor?.blockId;

/** Rank semantic relevance before asking the browser for expensive geometry. */
export const relevantParticipants = (
  people: readonly PresenceUser[],
  blockIds: readonly string[],
  localBlock: string | undefined,
): readonly PresenceUser[] => {
  const positions = new Map(blockIds.map((id, index) => [id, index]));
  const local =
    localBlock === undefined ? undefined : positions.get(localBlock);
  const distance = (person: PresenceUser) => {
    const position = positions.get(presenceBlock(person) ?? "");
    return position === undefined || local === undefined
      ? Infinity
      : Math.abs(position - local);
  };
  return people
    .filter(
      (person) =>
        person.status === "active" &&
        person.meta?.foreground !== false &&
        positions.has(presenceBlock(person) ?? ""),
    )
    .sort(
      (a, b) =>
        distance(a) - distance(b) ||
        Number(b.meta?.activity === "editing") -
          Number(a.meta?.activity === "editing") ||
        a.connectionId.localeCompare(b.connectionId),
    )
    .slice(0, 5);
};

export const sectionForParticipant = (
  person: PresenceUser,
  blocks: readonly { id: string; type: string; text: string }[],
): string | null => {
  if (person.meta?.foreground === false) return null;
  const index = blocks.findIndex((block) => block.id === presenceBlock(person));
  if (index < 0) return null;
  for (let i = index; i >= 0; i -= 1) {
    const block = blocks[i];
    if (block !== undefined && /^h[123]$/.test(block.type))
      return block.text.trim().slice(0, 100) || "Untitled section";
  }
  return "Document opening";
};
