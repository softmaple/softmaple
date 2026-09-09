import type {
  LexicalBinding,
  StableBlockSelection,
} from "@softmaple/binding-lexical";

export type ReturnPlace = {
  readonly selection: StableBlockSelection | null;
  readonly sections: readonly string[];
};
const startOf = (blockId: string): StableBlockSelection => {
  const point = {
    blockId,
    anchor: { type: "boundary", edge: "start", affinity: "after" } as const,
  };
  return { anchor: point, focus: point };
};

/** Capture section fallbacks while the original location still exists. */
export const capturePlace = (binding: LexicalBinding): ReturnPlace => {
  const selection = binding.captureSelection();
  const blocks = binding.replica.getDocument().blocks;
  const position = blocks.findIndex(
    (block) => block.id === selection?.focus.blockId,
  );
  const sections = blocks
    .slice(0, position + 1)
    .filter((block) => /^h[123]$/.test(block.type))
    .map((block) => block.id)
    .reverse();
  return { selection, sections };
};

export const resolvePlace = (
  binding: LexicalBinding,
  place: ReturnPlace,
): { selection: StableBlockSelection; explanation: string | null } | null => {
  const blocks = binding.replica.getDocument().blocks;
  if (
    place.selection !== null &&
    blocks.some((block) => block.id === place.selection?.focus.blockId)
  ) {
    try {
      const resolved = binding.tryResolveSelection(place.selection);
      if (resolved.status === "resolved")
        return { selection: place.selection, explanation: null };
    } catch {
      /* A deleted passage resolves through the captured section list. */
    }
  }
  const section = place.sections.find((id) =>
    blocks.some((block) => block.id === id),
  );
  const blockId = section ?? blocks[0]?.id;
  return blockId === undefined
    ? null
    : {
        selection: startOf(blockId),
        explanation:
          "Your original passage is unavailable. Returned to the nearest surviving section or document start.",
      };
};

/** Scroll only the owning pane. Never focus an editor or move its selection. */
export const revealAnchor = (
  binding: LexicalBinding,
  anchor: StableBlockSelection,
  pane: HTMLElement,
): boolean => {
  try {
    const resolved = binding.tryResolveSelection(anchor);
    if (resolved.status !== "resolved") return false;
    const key = binding
      .getBlockIndex()
      .blockIdToNodeKey.get(resolved.selection.focus.blockId);
    const element =
      key === undefined ? null : binding.editor.getElementByKey(key);
    if (element === null) return false;
    pane.scrollTop +=
      element.getBoundingClientRect().top -
      pane.getBoundingClientRect().top -
      40;
    return true;
  } catch {
    return false;
  }
};
