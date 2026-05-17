import { act, type JSX, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { POSITION_OPERATION_TYPE } from "../mapping/position-operation";
import {
  type UseTextareaSelectionSyncResult,
  useTextareaSelectionSync,
} from "./use-textarea-selection-sync";

const reactActGlobal = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};
reactActGlobal.IS_REACT_ACT_ENVIRONMENT = true;

type Harness = {
  readonly getApi: () => UseTextareaSelectionSyncResult;
  readonly getTextarea: () => HTMLTextAreaElement;
  readonly setValue: (value: string) => void;
  readonly unmount: () => void;
};

const renderHarness = (initialValue: string): Harness => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const apiRef: { current: UseTextareaSelectionSyncResult | null } = {
    current: null,
  };
  const setValueRef: { current: ((value: string) => void) | null } = {
    current: null,
  };

  const HarnessComponent = (): JSX.Element => {
    const [value, setValue] = useState(initialValue);
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);
    apiRef.current = useTextareaSelectionSync(textareaRef);
    setValueRef.current = setValue;

    return <textarea ref={textareaRef} readOnly value={value} />;
  };

  act(() => {
    root.render(<HarnessComponent />);
  });

  return {
    getApi: () => {
      if (!apiRef.current) {
        throw new Error("Textarea selection sync API was not rendered");
      }
      return apiRef.current;
    },
    getTextarea: () => {
      const textarea = container.querySelector("textarea");
      if (!textarea) {
        throw new Error("Textarea was not rendered");
      }
      return textarea;
    },
    setValue: (value: string) => {
      if (!setValueRef.current) {
        throw new Error("Textarea value setter was not rendered");
      }
      setValueRef.current(value);
    },
    unmount: () => {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
};

afterEach(() => {
  document.body.replaceChildren();
});

describe("useTextareaSelectionSync", () => {
  it("captures the current textarea selection", () => {
    const harness = renderHarness("hello world");
    const textarea = harness.getTextarea();
    textarea.setSelectionRange(2, 7, "forward");

    const selection = harness.getApi().captureSelection();

    expect(selection).toEqual({
      selectionStart: 2,
      selectionEnd: 7,
      selectionDirection: "forward",
    });
    harness.unmount();
  });

  it("restores a captured selection after a React value update", () => {
    const harness = renderHarness("hello world");
    const textarea = harness.getTextarea();
    textarea.setSelectionRange(6, 11, "forward");
    const api = harness.getApi();
    const captured = api.captureSelection();

    act(() => {
      harness.setValue("hello brave world");
      api.restoreSelection(captured);
    });

    expect(textarea.selectionStart).toBe(6);
    expect(textarea.selectionEnd).toBe(11);
    expect(textarea.selectionDirection).toBe("forward");
    harness.unmount();
  });

  it("maps and restores a cursor through a remote insert before it", () => {
    const harness = renderHarness("hello world");
    const textarea = harness.getTextarea();
    textarea.setSelectionRange(11, 11, "none");
    const api = harness.getApi();
    api.captureSelection();
    let mappedSelection: ReturnType<
      UseTextareaSelectionSyncResult["mapAndRestoreSelection"]
    > | null = null;

    act(() => {
      harness.setValue("hey, hello world");
      mappedSelection = api.mapAndRestoreSelection({
        type: POSITION_OPERATION_TYPE.Insert,
        index: 0,
        length: 5,
      });
    });

    expect(mappedSelection).toEqual({
      selectionStart: 16,
      selectionEnd: 16,
      selectionDirection: "none",
    });
    expect(textarea.selectionStart).toBe(16);
    expect(textarea.selectionEnd).toBe(16);
    expect(textarea.selectionDirection).toBe("none");
    harness.unmount();
  });

  it("maps and restores a cursor through a remote delete before it", () => {
    const harness = renderHarness("hello brave world");
    const textarea = harness.getTextarea();
    textarea.setSelectionRange(12, 12, "none");
    const api = harness.getApi();
    api.captureSelection();

    act(() => {
      harness.setValue("hello world");
      api.mapAndRestoreSelection({
        type: POSITION_OPERATION_TYPE.Delete,
        index: 5,
        length: 6,
      });
    });

    expect(textarea.selectionStart).toBe(6);
    expect(textarea.selectionEnd).toBe(6);
    expect(textarea.selectionDirection).toBe("none");
    harness.unmount();
  });

  it("collapses an overlapping delete selection to the mapped boundary", () => {
    const harness = renderHarness("hello brave world");
    const textarea = harness.getTextarea();
    textarea.setSelectionRange(6, 12, "forward");
    const api = harness.getApi();
    api.captureSelection();

    act(() => {
      harness.setValue("hello world");
      api.mapAndRestoreSelection({
        type: POSITION_OPERATION_TYPE.Delete,
        index: 5,
        length: 7,
      });
    });

    expect(textarea.selectionStart).toBe(5);
    expect(textarea.selectionEnd).toBe(5);
    expect(textarea.selectionDirection).toBe("none");
    harness.unmount();
  });
});
