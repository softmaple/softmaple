import type { CursorPosition, SelectionRange } from "./types/presence";

export interface PositionMapper {
  /**
   * Map a block-relative offset through the consumer's latest local document
   * change. Return null when the position no longer exists.
   */
  mapPosition(input: { readonly blockId: string; readonly offset: number }): {
    readonly blockId: string;
    readonly offset: number;
  } | null;
}

export interface PresenceResolver {
  /**
   * Resolve an anchored cursor against the local document. Return null when
   * the anchor no longer points to renderable content.
   */
  resolveCursor?(cursor: CursorPosition, userId: string): CursorPosition | null;
  /**
   * Resolve an anchored selection against the local document. Return null when
   * the anchor no longer points to renderable content.
   */
  resolveSelection?(
    selection: SelectionRange,
    userId: string,
  ): SelectionRange | null;
}
