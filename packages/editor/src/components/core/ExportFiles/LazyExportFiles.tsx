import { lazy } from "react";

export const LazyExportFilesDropdownMenu = lazy(() =>
  import("./ExportFilesDropdownMenu").then((module) => ({
    default: module.ExportFilesDropdownMenu,
  })),
);
