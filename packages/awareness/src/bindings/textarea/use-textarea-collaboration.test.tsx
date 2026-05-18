import { act, type JSX, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
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

afterAll(() => {
  reactActGlobal.IS_REACT_ACT_ENVIRONMENT = previousReactActEnvironment;
});

type HarnessProps = {
  readonly onLocalOperations: (
    operations: readonly TextareaOperation[],
  ) => void;
  readonly textareaKey?: string;
};

type Harness = {
  readonly api: { current: UseTextareaCollaborationResult | null };
  readonly textarea: () => HTMLTextAreaElement;
  /**
   * Re-render with a fresh `onLocalOperations` callback identity. This
   * is the path that exercises the hook's ref-update logic. A stable
   * outer closure that internally reads a mutable variable would
   * sidestep it and produce a false positive.
   */
  readonly rerenderWith: (
    onLocalOperations: HarnessProps["onLocalOperations"],
    textareaKey?: string,
  ) => void;
  readonly unmount: () => void;
};

let mountedHarnesses: Harness[] = [];

const renderHarness = (
  initialOnLocalOperations: HarnessProps["onLocalOperations"],
): Harness => {
  const container = document.createElement("div");
  document.body.append(container);
  const root: Root = createRoot(container);
  const api: { current: UseTextareaCollaborationResult | null } = {
    current: null,
  };

  const HarnessComponent = ({
    onLocalOperations,
    textareaKey = "textarea",
  }: HarnessProps): JSX.Element => {
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);
    api.current = useTextareaCollaboration({
      textareaRef,
      onLocalOperations,
    });
    return <textarea key={textareaKey} ref={textareaRef} />;
  };

  act(() => {
    root.render(
      <HarnessComponent onLocalOperations={initialOnLocalOperations} />,
    );
  });

  const textareaEl = container.querySelector("textarea");
  if (!textareaEl) {
    throw new Error("expected textarea to be rendered");
  }

  const harness: Harness = {
    api,
    textarea: () => {
      const currentTextarea = container.querySelector("textarea");
      if (!currentTextarea) {
        throw new Error("expected textarea to be rendered");
      }
      return currentTextarea;
    },
    rerenderWith: (onLocalOperations, textareaKey) => {
      act(() => {
        root.render(
          <HarnessComponent
            onLocalOperations={onLocalOperations}
            textareaKey={textareaKey}
          />,
        );
      });
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
    // Re-render with a *different function identity* so we're actually
    // exercising the hook's ref-update path, not just a closure over a
    // mutable outer variable.
    const first = vi.fn();
    const second = vi.fn();
    const harness = renderHarness(first);

    act(() => {
      const textarea = harness.textarea();
      textarea.value = "a";
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(first).toHaveBeenCalledTimes(1);

    harness.rerenderWith(second);

    act(() => {
      const textarea = harness.textarea();
      textarea.value = "ab";
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    expect(second.mock.calls[0]?.[0]).toEqual([
      {
        type: POSITION_OPERATION_TYPE.Insert,
        index: 1,
        length: 1,
        text: "b",
      },
    ]);
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

  it("reattaches when the textarea element changes", () => {
    const onLocal = vi.fn();
    const harness = renderHarness(onLocal);
    const previousTextarea = harness.textarea();

    harness.rerenderWith(onLocal);
    harness.rerenderWith(onLocal, "replacement");
    const nextTextarea = harness.textarea();

    expect(nextTextarea).not.toBe(previousTextarea);

    act(() => {
      previousTextarea.value = "stale";
      previousTextarea.dispatchEvent(new Event("input", { bubbles: true }));
      nextTextarea.value = "fresh";
      nextTextarea.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(onLocal).toHaveBeenCalledTimes(1);
    expect(onLocal.mock.calls[0]?.[0]).toEqual([
      {
        type: POSITION_OPERATION_TYPE.Insert,
        index: 0,
        length: 5,
        text: "fresh",
      },
    ]);
  });

  it("returns defensive defaults before a textarea element is available", () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const api: { current: UseTextareaCollaborationResult | null } = {
      current: null,
    };

    const EmptyHarness = (): JSX.Element => {
      const textareaRef = useRef<HTMLTextAreaElement | null>(null);
      api.current = useTextareaCollaboration({
        textareaRef,
        onLocalOperations: vi.fn(),
      });
      return <div />;
    };

    act(() => {
      root.render(<EmptyHarness />);
    });

    const selection = {
      selectionStart: 1,
      selectionEnd: 2,
      selectionDirection: "forward" as const,
    };

    expect(api.current?.getDocumentSnapshot()).toBe("");
    expect(api.current?.getSelection()).toBeNull();
    expect(() => api.current?.restoreSelection(selection)).not.toThrow();
    expect(api.current?.mapSelectionThroughOperations(selection, [])).toEqual(
      selection,
    );
    expect(api.current?.isComposing()).toBe(false);

    act(() => {
      root.unmount();
    });
    container.remove();
  });
});
