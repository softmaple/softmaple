import { lazy } from "react";

export const LazyFormatButtonGroup = lazy(() =>
  import("./FormatButtonGroup").then((module) => ({
    default: module.FormatButtonGroup,
  })),
);

export const LazyHistoryButtonGroup = lazy(() =>
  import("./HistoryButtonGroup").then((module) => ({
    default: module.HistoryButtonGroup,
  })),
);

export const LazyBlockFormatDropdown = lazy(() =>
  import("./BlockFormatDropdown").then((module) => ({
    default: module.BlockFormatDropdown,
  })),
);
