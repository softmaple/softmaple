import type { PresenceUser } from "@softmaple/awareness";

/**
 * Who gets drawn, and who gets counted.
 *
 * A busy room is the case that breaks naive presence: measuring DOM geometry
 * for every peer costs a layout per peer per frame, and drawing them all turns
 * the document into confetti. So the room is *ranked and cut* before anything
 * is measured, and everyone below the cut is still counted — the roster stays
 * complete, only the overlay is bounded.
 *
 * Ranking prefers, in order: people who are actively editing, then people
 * whose caret is in a block this session can see, then the most recently
 * active. Ties break on connectionId so the order is stable frame to frame and
 * a caret does not swap places with another while nothing is happening.
 */

export const PRESENCE_LIMITS = {
  /** Carets and selections drawn in the viewport at once. */
  DetailedParticipants: 5,
  /** Of those, how many may show an expanded name label. */
  ExpandedLabels: 3,
  /** Shared-attention invitations shown at once. */
  Invitations: 1,
} as const;

export type PresenceRelevanceInput = {
  /**
   * Blocks currently within (or near) the viewport. `null` means "not known
   * yet" and is treated as no penalty, so the first frame is not empty.
   */
  readonly visibleBlockIds: ReadonlySet<string> | null;
  /** Now, in ms. Injected so ranking is deterministic under test. */
  readonly now: number;
};

export type RankedPresence = {
  /** Peers to measure and draw, already truncated. */
  readonly detailed: ReadonlyArray<PresenceUser>;
  /** Of `detailed`, those that may show an expanded label. */
  readonly expandedLabelIds: ReadonlySet<string>;
  /** Everyone present but not drawn. Never dropped from the roster. */
  readonly overflowCount: number;
  /** Everyone present, drawn or not. */
  readonly totalCount: number;
};

/** Blocks a user's cursor or selection touches, for visibility scoring. */
const referencedBlockIds = (user: PresenceUser): ReadonlyArray<string> => {
  const blocks: string[] = [];
  const cursor = user.cursor;
  if (cursor !== undefined && "blockId" in cursor) blocks.push(cursor.blockId);
  const selection = user.selection;
  if (selection !== undefined) {
    if ("blockId" in selection) {
      blocks.push(selection.blockId);
    } else {
      blocks.push(selection.anchor.blockId, selection.focus.blockId);
    }
  }
  return blocks;
};

/** Higher sorts first. */
const relevanceScore = (
  user: PresenceUser,
  { visibleBlockIds }: PresenceRelevanceInput,
): number => {
  const editing = user.meta?.isTyping === true ? 4 : 0;
  const active = user.status === "active" ? 2 : 0;
  const visible =
    visibleBlockIds === null ||
    referencedBlockIds(user).some((blockId) => visibleBlockIds.has(blockId))
      ? 1
      : 0;
  return editing + active + visible;
};

/**
 * Rank and cut the room.
 *
 * Peers with no position at all are excluded from the overlay — there is
 * nothing to draw — but they remain in `totalCount`, because they *are* in the
 * document and the roster must say so.
 */
export const rankPresence = (
  users: ReadonlyArray<PresenceUser>,
  input: PresenceRelevanceInput,
): RankedPresence => {
  const positioned = users.filter(
    (user) => user.cursor !== undefined || user.selection !== undefined,
  );

  const ordered = [...positioned].sort((left, right) => {
    const byScore = relevanceScore(right, input) - relevanceScore(left, input);
    if (byScore !== 0) return byScore;
    const byActivity = right.lastActivityAt - left.lastActivityAt;
    if (byActivity !== 0) return byActivity;
    // Stable, so carets do not trade places between frames.
    return left.connectionId < right.connectionId ? -1 : 1;
  });

  const detailed = ordered.slice(0, PRESENCE_LIMITS.DetailedParticipants);
  return Object.freeze({
    detailed,
    expandedLabelIds: new Set(
      detailed
        .slice(0, PRESENCE_LIMITS.ExpandedLabels)
        .map((user) => user.connectionId),
    ),
    overflowCount: users.length - detailed.length,
    totalCount: users.length,
  });
};
