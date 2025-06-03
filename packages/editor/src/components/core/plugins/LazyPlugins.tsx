import { lazy } from "react";

export const LazyMarkdownPlugin = lazy(() =>
  import(
    "@softmaple/editor/components/core/plugins/MarkdownShortcutPlugin/MarkdownShortcutPlugin"
  ).then((module) => ({
    default: module.MarkdownPlugin,
  })),
);

export const LazyShortcutsPlugin = lazy(() =>
  import(
    "@softmaple/editor/components/core/plugins/ShortcutsPlugin/ShortcutsPlugin"
  ).then((module) => ({
    default: module.ShortcutsPlugin,
  })),
);
