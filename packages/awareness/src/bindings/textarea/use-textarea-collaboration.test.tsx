import { act, type JSX, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POSITION_OPERATION_TYPE } from "../../mapping/position-operation";
import type { TextareaOperation } from "./textarea-operations";
import {
  type UseTextareaCollaborationResult,
  useTextareaCollaboration,
} from "./use-textarea-collaboration";

const reactActGlobal = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};
const previousReactActEnvironment = reactActGlobal.IS_REACT_ACT_ENVIRONMENT;
reactActGlobal.IS_REACT_ACT_ENVIRONMENT = true;

type Harness = {
  readonly api: { current: UseTextareaCollaborationResult | null };
  readonly textarea: () => HTMLTextAreaElement;
  readonly setOnLocalOperations: (
    fn: (ops: readonly TextareaOperation[]) => void,
  ) => void;
  readonly unmount: () => void;
};

let mountedHarnesses: Harness[] = [];

const renderHarness = (
  initialOnLocalOperations: (ops: readonly TextareaOperation[]) => void,
): Harness => {
  const container = document.createElement("div");
  document.body.append(container);
  const root: Root = createRoot(container);
  const api: { current: UseTextareaCollaborationResult | null } = {
    current: null,
  };
  let currentOnLocal = initialOnLocalOperations;

  const HarnessComponent = (): JSX.Element => {
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);
    api.current = useTextareaCollaboration({
      textareaRef,
      onLocalOperations: (ops) => currentOnLocal(ops),
    });
    return <textarea ref={textareaRef} />;
  };

  act(() => {
    root.render(<HarnessComponent />);
  });

  const textareaEl = container.querySelector("textarea");
  if (!textareaEl) {
    throw new Error("expected textarea to be rendered");
  }

  const harness: Harness = {
    api,
    textarea: () => textareaEl,
    setOnLocalOperations: (fn) => {
      currentOnLocal = fn;
    },
    unmount: () => {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
  mountedHarnesses.push(harness);
  return harness;
};

beforeEach(() => {
  mountedHarnesses = [];
});

afterEach(() => {
  for (const harness of mountedHarnesses) {
    try {
      harness.unmount();
    } catch {
      // Already unmounted by the test.
    }
  }
  mountedHarnesses = [];
  document.body.replaceChildren();
});

if (previousReactActEnvironment === undefined) {
  // Leave the global flag set for the duration of the test file; reset on
  // module teardown to avoid leaking into sibling files.
  globalThis.addEventListener?.("beforeunload", () => {
    reactActGlobal.IS_REACT_ACT_ENVIRONMENT = previousReactActEnvironment;
  });
}

describe("useTextareaCollaboration", () => {
  it("forwards local operations from input events to the callback", () => {
    const onLocal = vi.fn();
    const harness = renderHarness(onLocal);

    act(() => {
      const textarea = harness.textarea();
      textarea.value = "hello";
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(onLocal).toHaveBeenCalledTimes(1);
    expect(onLocal.mock.calls[0]?.[0]).toEqual([
      {
        type: POSITION_OPERATION_TYPE.Insert,
        index: 0,
        length: 5,
        text: "hello",
      },
    ]);
  });

  it("uses the most recent onLocalOperations callback without re-creating the adapter", () => {
    const first = vi.fn();
    const second = vi.fn();
    const harness = renderHarness(first);

    act(() => {
      const textarea = harness.textarea();
      textarea.value = "a";
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(first).toHaveBeenCalledTimes(1);

    harness.setOnLocalOperations(second);

    act(() => {
      const textarea = harness.textarea();
      textarea.value = "ab";
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("applyRemoteOperations writes through to the textarea", () => {
    const harness = renderHarness(vi.fn());

    act(() => {
      harness.api.current?.applyRemoteOperations([
        {
          type: POSITION_OPERATION_TYPE.Insert,
          index: 0,
          length: 5,
          text: "hello",
        },
      ]);
    });

    expect(harness.textarea().value).toBe("hello");
  });

  it("exposes selection helpers", () => {
    const harness = renderHarness(vi.fn());
    const textarea = harness.textarea();
    textarea.focus();
    textarea.value = "hello";
    textarea.setSelectionRange(1, 4, "forward");

    expect(harness.api.current?.getSelection()).toEqual({
      selectionStart: 1,
      selectionEnd: 4,
      selectionDirection: "forward",
    });

    act(() => {
      harness.api.current?.restoreSelection({
        selectionStart: 0,
        selectionEnd: 5,
        selectionDirection: "backward",
      });
    });

    expect(textarea.selectionStart).toBe(0);
    expect(textarea.selectionEnd).toBe(5);
  });

  it("detaches DOM listeners on unmount", () => {
    const onLocal = vi.fn();
    const harness = renderHarness(onLocal);
    const textarea = harness.textarea();

    harness.unmount();

    textarea.value = "after-unmount";
    textarea.dispatchEvent(new Event("input", { bubbles: true }));

    expect(onLocal).not.toHaveBeenCalled();
  });
});
