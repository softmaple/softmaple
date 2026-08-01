import { describe, expect, it } from "vitest";
import {
  DEFAULT_EDITOR_HISTORY_MODE,
  isLocalEditorHistoryEnabled,
  resolveCoreEditorLayoutClassName,
  type EditorHistoryMode,
} from "./editorOptions";

describe("editor options", () => {
  it("keeps local history as the default mode", () => {
    const mode: EditorHistoryMode = DEFAULT_EDITOR_HISTORY_MODE;

    expect(mode).toBe("local");
    expect(isLocalEditorHistoryEnabled(mode)).toBe(true);
    expect(isLocalEditorHistoryEnabled("disabled")).toBe(false);
  });

  it("merges full-canvas classes over the default layout constraints", () => {
    const className = resolveCoreEditorLayoutClassName(
      "mx-0 my-0 max-w-none min-h-screen",
    );

    expect(className).toContain("mx-0");
    expect(className).toContain("my-0");
    expect(className).toContain("max-w-none");
    expect(className).toContain("min-h-screen");
    expect(className).not.toContain("mx-12");
    expect(className).not.toContain("my-auto");
    expect(className).not.toContain("max-w-6xl");
  });
});
