/**
 * Regression test for the IME / Chinese-input bug fixed in PR #703.
 *
 * Before the fix, the textarea was diffing every intermediate `input`
 * event into the eg-walker CRDT, so typing pinyin "nihao" produced six
 * insert ops for the latin intermediates and then a wrong delete-3 /
 * insert-2 op pair on commit, which `setText(replica.getText())` then
 * snapped back to a garbled "ao".
 *
 * The fix is composition-aware: intermediate `input` events fired
 * while `composingRef.current` is `true` are swallowed, and a single
 * diff is emitted from `onCompositionEnd` with the post-commit value.
 * The trailing post-commit `input` event Chrome / WebKit fire after
 * `compositionend` is also suppressed via `lastCompositionCommitRef`
 * so the commit doesn't double-dispatch.
 */
import { act, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Mock the awareness module. `EditorSurface` only consults the hooks
// for side-effect dispatchers (cursor / selection / typing) and reads
// `useOthers()` for the overlay map — we don't care about presence in
// this test, only that composition events route through the textarea
// handlers and produce the right `onTextChange` calls. Stubbing the
// overlay components to `null` keeps the test focused on the textarea.
vi.mock("@softmaple/awareness", () => ({
  useOthers: () => [],
  useUpdateCursor: () => vi.fn(),
  useUpdateSelection: () => vi.fn(),
  useUpdateTyping: () => vi.fn(),
  LiveCursor: () => null,
  PresenceLayer: ({ children }: { children?: React.ReactNode }) => (
    <>{children}</>
  ),
  SelectionHighlight: () => null,
  getTextareaCaretRect: () => ({ top: 0, left: 0, height: 16 }),
  getTextareaSelectionRects: () => [],
}));

// `BlockActivityBadge` reaches into `usePeersInBlock` which needs a
// `<PresenceProvider>` ancestor. Stub it out — this test is about
// composition handling, not the badge.
vi.mock("@/components/awareness-collab/BlockActivityBadge", () => ({
  BlockActivityBadge: () => null,
}));

import {
  POSITION_OPERATION_TYPE,
  type PositionOperation,
} from "@softmaple/awareness/mapping";
import type { RefObject } from "react";
import { useRef } from "react";
import { EditorSurface } from "@/components/awareness-collab/EditorSurface";

const Harness = ({
  text,
  onTextChange,
  pendingMappingOperationsRef,
}: {
  text: string;
  onTextChange: (next: string) => void;
  pendingMappingOperationsRef?: RefObject<PositionOperation[]>;
}): React.ReactNode => {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const defaultPendingMappingOperationsRef = useRef<PositionOperation[]>([]);
  return (
    <EditorSurface
      blockId="block-1"
      text={text}
      onTextChange={onTextChange}
      textareaRef={textareaRef}
      trainerId="trainer-1"
      pendingMappingOperationsRef={
        pendingMappingOperationsRef ?? defaultPendingMappingOperationsRef
      }
    />
  );
};

afterEach(() => {
  document.body.replaceChildren();
});

// React installs a value tracker on input/textarea instances so onChange
// only fires when the live DOM value differs from the last value it
// remembers. Assigning `textarea.value = "..."` goes through React's
// instance setter and updates the tracker, which makes a subsequent
// `dispatchEvent(new Event("input"))` a no-op as far as onChange is
// concerned. `fireEvent.input(el, { target: { value } })` bypasses the
// instance setter via the prototype-level descriptor so React sees the
// change and fires onChange — that's the path real keystrokes take.
const fireInput = (textarea: HTMLTextAreaElement, value: string): void => {
  fireEvent.input(textarea, { target: { value } });
};

describe("EditorSurface — IME composition handling", () => {
  it("emits a single onTextChange for the whole composition (Chrome ordering: compositionend before final input)", async () => {
    const onTextChange = vi.fn();
    const { container } = render(
      <Harness text="" onTextChange={onTextChange} />,
    );
    const textarea = container.querySelector("textarea");
    expect(textarea).toBeInstanceOf(HTMLTextAreaElement);
    if (!textarea) throw new Error("expected textarea");

    await act(async () => {
      // Composition begins. Intermediate `input` events fire with the
      // latin pinyin as the IME assembles the candidate.
      fireEvent.compositionStart(textarea);
      for (const intermediate of ["n", "ni", "nih", "niha", "nihao"]) {
        fireInput(textarea, intermediate);
      }
    });
    // Every intermediate must be swallowed — diffing those into the
    // CRDT was the original bug.
    expect(onTextChange).not.toHaveBeenCalled();

    await act(async () => {
      // IME commits. Chrome (and WebKit) order: DOM value updates,
      // compositionend fires, then a trailing input event with the
      // same post-commit value.
      textarea.value = "你好";
      fireEvent.compositionEnd(textarea, { data: "你好" });
      fireInput(textarea, "你好");
    });

    // Exactly one dispatch with the committed value. Two would mean
    // the trailing post-commit input event leaked through and
    // re-dispatched (the bug item this test was added to guard).
    expect(onTextChange).toHaveBeenCalledTimes(1);
    expect(onTextChange).toHaveBeenCalledWith("你好");
  });

  it("treats the next input after compositionend as a real keystroke when its value differs from the commit", async () => {
    const onTextChange = vi.fn();
    const { container } = render(
      <Harness text="" onTextChange={onTextChange} />,
    );
    const textarea = container.querySelector("textarea");
    if (!textarea) throw new Error("expected textarea");

    await act(async () => {
      fireEvent.compositionStart(textarea);
      fireInput(textarea, "ni");
      textarea.value = "你";
      fireEvent.compositionEnd(textarea, { data: "你" });
      // Simulate a user typing a plain ASCII keystroke right after
      // commit — value is now different from `lastCompositionCommitRef`,
      // so the suppression must NOT swallow this dispatch.
      fireInput(textarea, "你!");
    });

    expect(onTextChange).toHaveBeenCalledTimes(2);
    expect(onTextChange).toHaveBeenNthCalledWith(1, "你");
    expect(onTextChange).toHaveBeenNthCalledWith(2, "你!");
  });

  it("resets composingRef on blur so a dropped compositionend can't swallow subsequent keystrokes", async () => {
    const onTextChange = vi.fn();
    const { container } = render(
      <Harness text="" onTextChange={onTextChange} />,
    );
    const textarea = container.querySelector("textarea");
    if (!textarea) throw new Error("expected textarea");

    await act(async () => {
      fireEvent.compositionStart(textarea);
      fireInput(textarea, "n");
      // No compositionend — simulate the buggy-IME / focus-yank case.
      fireEvent.blur(textarea);
      // Subsequent keystroke must dispatch normally.
      fireInput(textarea, "hello");
    });

    expect(onTextChange).toHaveBeenCalledTimes(1);
    expect(onTextChange).toHaveBeenCalledWith("hello");
  });
});

describe("EditorSurface — remote selection mapping", () => {
  it("maps the caret through a remote insert before the cursor", () => {
    // Arrange
    const pendingMappingOperationsRef = createPendingMappingOperationsRef();
    const { container, rerender } = render(
      <Harness
        text="hello"
        onTextChange={vi.fn()}
        pendingMappingOperationsRef={pendingMappingOperationsRef}
      />,
    );
    const textarea = getTextarea(container);
    textarea.setSelectionRange(3, 3);
    pendingMappingOperationsRef.current.push({
      type: POSITION_OPERATION_TYPE.Insert,
      index: 1,
      length: 2,
    });

    // Act
    rerender(
      <Harness
        text="hXXello"
        onTextChange={vi.fn()}
        pendingMappingOperationsRef={pendingMappingOperationsRef}
      />,
    );

    // Assert
    expect(textarea.selectionStart).toBe(5);
    expect(textarea.selectionEnd).toBe(5);
    expect(pendingMappingOperationsRef.current).toEqual([]);
  });

  it("maps the caret through a remote delete before the cursor", () => {
    // Arrange
    const pendingMappingOperationsRef = createPendingMappingOperationsRef();
    const { container, rerender } = render(
      <Harness
        text="hello world"
        onTextChange={vi.fn()}
        pendingMappingOperationsRef={pendingMappingOperationsRef}
      />,
    );
    const textarea = getTextarea(container);
    textarea.setSelectionRange(5, 5);
    pendingMappingOperationsRef.current.push({
      type: POSITION_OPERATION_TYPE.Delete,
      index: 1,
      length: 3,
    });

    // Act
    rerender(
      <Harness
        text="ho world"
        onTextChange={vi.fn()}
        pendingMappingOperationsRef={pendingMappingOperationsRef}
      />,
    );

    // Assert
    expect(textarea.selectionStart).toBe(2);
    expect(textarea.selectionEnd).toBe(2);
  });

  it("collapses the selection when a remote delete overlaps it", () => {
    // Arrange
    const pendingMappingOperationsRef = createPendingMappingOperationsRef();
    const { container, rerender } = render(
      <Harness
        text="abcdefg"
        onTextChange={vi.fn()}
        pendingMappingOperationsRef={pendingMappingOperationsRef}
      />,
    );
    const textarea = getTextarea(container);
    textarea.setSelectionRange(2, 5);
    pendingMappingOperationsRef.current.push({
      type: POSITION_OPERATION_TYPE.Delete,
      index: 1,
      length: 5,
    });

    // Act
    rerender(
      <Harness
        text="ag"
        onTextChange={vi.fn()}
        pendingMappingOperationsRef={pendingMappingOperationsRef}
      />,
    );

    // Assert
    expect(textarea.selectionStart).toBe(1);
    expect(textarea.selectionEnd).toBe(1);
  });

  it("does not expand the selection for a remote insert at selection end", () => {
    // Arrange
    const pendingMappingOperationsRef = createPendingMappingOperationsRef();
    const { container, rerender } = render(
      <Harness
        text="abcd"
        onTextChange={vi.fn()}
        pendingMappingOperationsRef={pendingMappingOperationsRef}
      />,
    );
    const textarea = getTextarea(container);
    textarea.setSelectionRange(1, 3);
    pendingMappingOperationsRef.current.push({
      type: POSITION_OPERATION_TYPE.Insert,
      index: 3,
      length: 2,
    });

    // Act
    rerender(
      <Harness
        text="abcXXd"
        onTextChange={vi.fn()}
        pendingMappingOperationsRef={pendingMappingOperationsRef}
      />,
    );

    // Assert
    expect(textarea.selectionStart).toBe(1);
    expect(textarea.selectionEnd).toBe(3);
  });
});

// Helpers
const createPendingMappingOperationsRef = (): RefObject<
  PositionOperation[]
> => ({
  current: [],
});

const getTextarea = (container: HTMLElement): HTMLTextAreaElement => {
  const textarea = container.querySelector("textarea");
  expect(textarea).toBeInstanceOf(HTMLTextAreaElement);
  if (!textarea) throw new Error("expected textarea");
  return textarea;
};
