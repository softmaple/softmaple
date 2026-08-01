import { cn } from "@softmaple/editor/lib/utils";

export type EditorHistoryMode = "local" | "disabled";

export const DEFAULT_EDITOR_HISTORY_MODE: EditorHistoryMode = "local";

const DEFAULT_CORE_EDITOR_LAYOUT_CLASS_NAME =
  "mx-12 my-auto max-w-6xl text-foreground relative leading-1.7 font-normal";

export const isLocalEditorHistoryEnabled = (
  historyMode: EditorHistoryMode,
): boolean => historyMode === "local";

export const resolveCoreEditorLayoutClassName = (
  layoutClassName?: string,
): string => cn(DEFAULT_CORE_EDITOR_LAYOUT_CLASS_NAME, layoutClassName);
