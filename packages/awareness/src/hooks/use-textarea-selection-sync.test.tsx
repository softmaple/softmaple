import { act, type JSX, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { POSITION_OPERATION_TYPE } from "../mapping/position-operation";
import {
  type UseTextareaSelectionSyncResult,
  useTextareaSelectionSync,
} from "./use-textarea-selection-sync";

const reactActGlobal = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};
const previousReactActEnvironment = reactActGlobal.IS_REACT_ACT_ENVIRONMENT;
reactActGlobal.IS_REACT_ACT_ENVIRONMENT = true;

type Harness = {
  readonly getApi: () => UseTextareaSelectionSyncResult;
  readonly getTextarea: () => HTMLTextAreaElement;
  readonly rerender: () => void;
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
  const rerenderRef: { current: (() => void) | null } = {
    current: null,
  };

  const HarnessComponent = (): JSX.Element => {
    const [value, setValue] = useState(initialValue);
    const [renderVersion, setRenderVersion] = useState(0);
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);
    apiRef.current = useTextareaSelectionSync(textareaRef);
    setValueRef.current = setValue;
    rerenderRef.current = () => {
      setRenderVersion((version) => version + 1);
    };

    return (
      <textarea
        data-render-version={renderVersion}
        ref={textareaRef}
        readOnly
        value={value}
      />
    );
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
    rerender: () => {
      if (!rerenderRef.current) {
        throw new Error("Textarea rerender callback was not rendered");
      }
      rerenderRef.current();
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

afterAll(() => {
  reactActGlobal.IS_REACT_ACT_ENVIRONMENT = previousReactActEnvironment;
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

  it("defaults unknown textarea selection directions to none", () => {
    const harness = renderHarness("hello world");
    const textarea = harness.getTextarea();
    textarea.setSelectionRange(2, 7, "forward");
    Object.defineProperty(textarea, "selectionDirection", {
      configurable: true,
      value: "sideways",
    });

    const selection = harness.getApi().captureSelection();

    expect(selection).toEqual({
      selectionStart: 2,
      selectionEnd: 7,
      selectionDirection: "none",
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

  it("does not replay a restore on an unrelated re-render", () => {
    const harness = renderHarness("hello world");
    const textarea = harness.getTextarea();
    const api = harness.getApi();
    api.restoreSelection({
      selectionStart: 0,
      selectionEnd: 0,
      selectionDirection: "none",
    });
    textarea.setSelectionRange(5, 5, "none");

    act(() => {
      harness.rerender();
    });

    expect(textarea.selectionStart).toBe(5);
    expect(textarea.selectionEnd).toBe(5);
    expect(textarea.selectionDirection).toBe("none");
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
      selectionStart: 11,
      selectionEnd: 11,
      selectionDirection: "none",
    });
    expect(textarea.selectionStart).toBe(16);
    expect(textarea.selectionEnd).toBe(16);
    expect(textarea.selectionDirection).toBe("none");
    harness.unmount();
  });

  it("preserves backward direction through a non-collapsing insert", () => {
    const harness = renderHarness("abcdef");
    const textarea = harness.getTextarea();
    textarea.setSelectionRange(2, 5, "backward");
    const api = harness.getApi();
    api.captureSelection();

    act(() => {
      harness.setValue("abcXXdef");
      api.mapAndRestoreSelection({
        type: POSITION_OPERATION_TYPE.Insert,
        index: 3,
        length: 2,
      });
    });

    expect(textarea.selectionStart).toBe(2);
    expect(textarea.selectionEnd).toBe(7);
    expect(textarea.selectionDirection).toBe("backward");
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

  it("returns the clamped selection applied to the textarea", () => {
    const harness = renderHarness("hello");
    const textarea = harness.getTextarea();

    const selection = harness.getApi().restoreSelection({
      selectionStart: 2,
      selectionEnd: 12,
      selectionDirection: "forward",
    });

    expect(selection).toEqual({
      selectionStart: 2,
      selectionEnd: 5,
      selectionDirection: "forward",
    });
    expect(textarea.selectionStart).toBe(2);
    expect(textarea.selectionEnd).toBe(5);
    expect(textarea.selectionDirection).toBe("forward");
    harness.unmount();
  });

  it("normalizes inverted selections before restoring", () => {
    const harness = renderHarness("hello world");
    const textarea = harness.getTextarea();

    const selection = harness.getApi().restoreSelection({
      selectionStart: 8,
      selectionEnd: 3,
      selectionDirection: "forward",
    });

    expect(selection).toEqual({
      selectionStart: 3,
      selectionEnd: 8,
      selectionDirection: "backward",
    });
    expect(textarea.selectionStart).toBe(3);
    expect(textarea.selectionEnd).toBe(8);
    expect(textarea.selectionDirection).toBe("backward");
    harness.unmount();
  });

  it("flips backward direction when normalizing inverted selections", () => {
    const harness = renderHarness("hello world");

    const selection = harness.getApi().restoreSelection({
      selectionStart: 8,
      selectionEnd: 3,
      selectionDirection: "backward",
    });

    expect(selection).toEqual({
      selectionStart: 3,
      selectionEnd: 8,
      selectionDirection: "forward",
    });
    harness.unmount();
  });

  it("normalizes inverted selections without a direction to none", () => {
    const harness = renderHarness("hello world");

    const selection = harness.getApi().restoreSelection({
      selectionStart: 8,
      selectionEnd: 3,
    });

    expect(selection).toEqual({
      selectionStart: 3,
      selectionEnd: 8,
      selectionDirection: "none",
    });
    harness.unmount();
  });

  it("returns null when the textarea ref is unavailable", () => {
    const harness = renderHarness("hello world");
    const api = harness.getApi();
    harness.unmount();

    expect(api.captureSelection()).toBeNull();
    expect(api.restoreSelection()).toBeNull();
    expect(
      api.mapAndRestoreSelection({
        type: POSITION_OPERATION_TYPE.Insert,
        index: 0,
        length: 1,
      }),
    ).toBeNull();
  });
});
