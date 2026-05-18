import { afterEach, describe, expect, it, vi } from "vitest";
import { POSITION_OPERATION_TYPE } from "../../mapping/position-operation";
import { createTextareaAdapter } from "./textarea-adapter";
import type { TextareaOperation } from "./textarea-operations";

const mountTextarea = (initialValue = ""): HTMLTextAreaElement => {
  const textarea = document.createElement("textarea");
  textarea.value = initialValue;
  document.body.append(textarea);
  return textarea;
};

const fireInput = (textarea: HTMLTextAreaElement, value: string): void => {
  textarea.value = value;
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
};

afterEach(() => {
  document.body.replaceChildren();
});

describe("createTextareaAdapter — local edits", () => {
  it("emits insert operations from input events", () => {
    const textarea = mountTextarea("");
    const adapter = createTextareaAdapter(textarea);
    const received: TextareaOperation[][] = [];
    adapter.observeLocalOperations((ops) => received.push([...ops]));

    fireInput(textarea, "hello");

    expect(received).toEqual([
      [
        {
          type: POSITION_OPERATION_TYPE.Insert,
          index: 0,
          length: 5,
          text: "hello",
        },
      ],
    ]);
    adapter.destroy();
  });

  it("emits delete operations from input events", () => {
    const textarea = mountTextarea("hello world");
    const adapter = createTextareaAdapter(textarea);
    const received: TextareaOperation[][] = [];
    adapter.observeLocalOperations((ops) => received.push([...ops]));

    fireInput(textarea, "world");

    expect(received).toEqual([
      [
        {
          type: POSITION_OPERATION_TYPE.Delete,
          index: 0,
          length: 6,
        },
      ],
    ]);
    adapter.destroy();
  });

  it("does not emit for no-op input events", () => {
    const textarea = mountTextarea("hello");
    const adapter = createTextareaAdapter(textarea);
    const received: TextareaOperation[][] = [];
    adapter.observeLocalOperations((ops) => received.push([...ops]));

    fireInput(textarea, "hello");

    expect(received).toEqual([]);
    adapter.destroy();
  });
});

describe("createTextareaAdapter — IME composition", () => {
  it("swallows intermediate input events while composing", () => {
    const textarea = mountTextarea("");
    const adapter = createTextareaAdapter(textarea);
    const received: TextareaOperation[][] = [];
    adapter.observeLocalOperations((ops) => received.push([...ops]));

    textarea.dispatchEvent(new Event("compositionstart"));
    for (const intermediate of ["n", "ni", "nih", "niha", "nihao"]) {
      fireInput(textarea, intermediate);
    }

    expect(received).toEqual([]);
    adapter.destroy();
  });

  it("emits one operation for the whole composition (Chrome ordering: compositionend then input)", () => {
    const textarea = mountTextarea("");
    const adapter = createTextareaAdapter(textarea);
    const received: TextareaOperation[][] = [];
    adapter.observeLocalOperations((ops) => received.push([...ops]));

    textarea.dispatchEvent(new Event("compositionstart"));
    fireInput(textarea, "nihao");
    textarea.value = "你好";
    textarea.dispatchEvent(new Event("compositionend"));
    fireInput(textarea, "你好");

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual([
      {
        type: POSITION_OPERATION_TYPE.Insert,
        index: 0,
        length: 2,
        text: "你好",
      },
    ]);
    adapter.destroy();
  });

  it("treats the next input after compositionend as a real keystroke when value differs from the commit", () => {
    const textarea = mountTextarea("");
    const adapter = createTextareaAdapter(textarea);
    const received: TextareaOperation[][] = [];
    adapter.observeLocalOperations((ops) => received.push([...ops]));

    textarea.dispatchEvent(new Event("compositionstart"));
    fireInput(textarea, "ni");
    textarea.value = "你";
    textarea.dispatchEvent(new Event("compositionend"));
    fireInput(textarea, "你!");

    expect(received).toHaveLength(2);
    expect(received[0]).toEqual([
      {
        type: POSITION_OPERATION_TYPE.Insert,
        index: 0,
        length: 1,
        text: "你",
      },
    ]);
    expect(received[1]).toEqual([
      {
        type: POSITION_OPERATION_TYPE.Insert,
        index: 1,
        length: 1,
        text: "!",
      },
    ]);
    adapter.destroy();
  });

  it("resets composing state on blur so a dropped compositionend cannot swallow subsequent keystrokes", () => {
    const textarea = mountTextarea("");
    const adapter = createTextareaAdapter(textarea);
    const received: TextareaOperation[][] = [];
    adapter.observeLocalOperations((ops) => received.push([...ops]));

    textarea.dispatchEvent(new Event("compositionstart"));
    fireInput(textarea, "n");
    textarea.dispatchEvent(new Event("blur"));
    fireInput(textarea, "hello");

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual([
      {
        type: POSITION_OPERATION_TYPE.Insert,
        index: 0,
        length: 5,
        text: "hello",
      },
    ]);
    adapter.destroy();
  });

  it("notifies onCompositionChange on enter and leave", () => {
    const textarea = mountTextarea("");
    const onCompositionChange = vi.fn();
    const adapter = createTextareaAdapter(textarea, {
      onCompositionChange,
    });

    textarea.dispatchEvent(new Event("compositionstart"));
    expect(adapter.isComposing()).toBe(true);
    textarea.value = "你";
    textarea.dispatchEvent(new Event("compositionend"));
    expect(adapter.isComposing()).toBe(false);

    expect(onCompositionChange).toHaveBeenNthCalledWith(1, true);
    expect(onCompositionChange).toHaveBeenNthCalledWith(2, false);
    adapter.destroy();
  });
});

describe("createTextareaAdapter — applyRemoteOperations", () => {
  it("writes the post-image to the textarea value", () => {
    const textarea = mountTextarea("hello");
    const adapter = createTextareaAdapter(textarea);

    adapter.applyRemoteOperations([
      {
        type: POSITION_OPERATION_TYPE.Insert,
        index: 5,
        length: 6,
        text: " world",
      },
    ]);

    expect(textarea.value).toBe("hello world");
    adapter.destroy();
  });

  it("does not re-emit local operations for the remote write", () => {
    const textarea = mountTextarea("hello");
    const adapter = createTextareaAdapter(textarea);
    const received: TextareaOperation[][] = [];
    adapter.observeLocalOperations((ops) => received.push([...ops]));

    adapter.applyRemoteOperations([
      {
        type: POSITION_OPERATION_TYPE.Insert,
        index: 5,
        length: 6,
        text: " world",
      },
    ]);
    // Following local edit must diff against the remote post-image,
    // not the pre-remote value.
    fireInput(textarea, "hello world!");

    expect(received).toEqual([
      [
        {
          type: POSITION_OPERATION_TYPE.Insert,
          index: 11,
          length: 1,
          text: "!",
        },
      ],
    ]);
    adapter.destroy();
  });

  it("maps the caret through a remote insert before the cursor", () => {
    const textarea = mountTextarea("hello");
    const adapter = createTextareaAdapter(textarea);
    textarea.focus();
    textarea.setSelectionRange(3, 3);

    adapter.applyRemoteOperations([
      {
        type: POSITION_OPERATION_TYPE.Insert,
        index: 1,
        length: 2,
        text: "XX",
      },
    ]);

    expect(textarea.value).toBe("hXXello");
    expect(textarea.selectionStart).toBe(5);
    expect(textarea.selectionEnd).toBe(5);
    adapter.destroy();
  });

  it("maps the caret through a remote delete before the cursor", () => {
    const textarea = mountTextarea("hello world");
    const adapter = createTextareaAdapter(textarea);
    textarea.focus();
    textarea.setSelectionRange(5, 5);

    adapter.applyRemoteOperations([
      { type: POSITION_OPERATION_TYPE.Delete, index: 1, length: 3 },
    ]);

    expect(textarea.value).toBe("ho world");
    expect(textarea.selectionStart).toBe(2);
    expect(textarea.selectionEnd).toBe(2);
    adapter.destroy();
  });

  it("collapses the selection when a remote delete overlaps it", () => {
    const textarea = mountTextarea("abcdefg");
    const adapter = createTextareaAdapter(textarea);
    textarea.focus();
    textarea.setSelectionRange(2, 5);

    adapter.applyRemoteOperations([
      { type: POSITION_OPERATION_TYPE.Delete, index: 1, length: 5 },
    ]);

    expect(textarea.value).toBe("ag");
    expect(textarea.selectionStart).toBe(1);
    expect(textarea.selectionEnd).toBe(1);
    adapter.destroy();
  });

  it("does not expand the selection for a remote insert at selection end", () => {
    const textarea = mountTextarea("abcd");
    const adapter = createTextareaAdapter(textarea);
    textarea.focus();
    textarea.setSelectionRange(1, 3);

    adapter.applyRemoteOperations([
      {
        type: POSITION_OPERATION_TYPE.Insert,
        index: 3,
        length: 2,
        text: "XX",
      },
    ]);

    expect(textarea.value).toBe("abcXXd");
    expect(textarea.selectionStart).toBe(1);
    expect(textarea.selectionEnd).toBe(3);
    adapter.destroy();
  });

  it("buffers writes while composing and replays them on compositionend before emitting the composition diff", () => {
    // Regression for #704: peer ops arriving mid-IME-composition must
    // not silently drop the DOM write, AND must update `lastValue` so
    // the post-composition diff lines up with the post-peer replica
    // state. See review thread on PR #755.
    const textarea = mountTextarea("hello");
    const adapter = createTextareaAdapter(textarea);
    const received: TextareaOperation[][] = [];
    adapter.observeLocalOperations((ops) => received.push([...ops]));
    textarea.focus();
    textarea.setSelectionRange(2, 2);

    // User starts composing. Mid-composition, a peer prepends "X".
    textarea.dispatchEvent(new Event("compositionstart"));
    adapter.applyRemoteOperations([
      {
        type: POSITION_OPERATION_TYPE.Insert,
        index: 0,
        length: 1,
        text: "X",
      },
    ]);
    // DOM is untouched mid-composition — writing would collapse the IME.
    expect(textarea.value).toBe("hello");

    // User commits 你 at the cursor position (between "he" and "llo").
    textarea.value = "he你llo";
    textarea.dispatchEvent(new Event("compositionend"));

    // After compositionend, the buffered peer op was replayed first.
    expect(textarea.value).toBe("Xhe你llo");
    // The emitted composition diff targets the post-peer baseline:
    // insert "你" at index 3 in "Xhello" gives "Xhe你llo".
    expect(received).toEqual([
      [
        {
          type: POSITION_OPERATION_TYPE.Insert,
          index: 3,
          length: 1,
          text: "你",
        },
      ],
    ]);
    adapter.destroy();
  });

  it("coalesces multiple buffered peer batches on compositionend", () => {
    // Multiple peer batches stack sequentially; second batch's indices
    // are in the post-first-batch space (as the route would produce
    // them via per-event textBefore/textAfter diffs). The buffer's
    // replay walks them in order against the evolving DOM, so as long
    // as no batch's index sits past the user's composition position
    // the result is well-defined. (Batches that DO straddle the
    // composition point still hit the underlying rebase problem
    // tracked in #704 — buffer-and-replay narrows the bug class, it
    // doesn't eliminate it.)
    const textarea = mountTextarea("hello");
    const adapter = createTextareaAdapter(textarea);
    const received: TextareaOperation[][] = [];
    adapter.observeLocalOperations((ops) => received.push([...ops]));

    textarea.dispatchEvent(new Event("compositionstart"));
    adapter.applyRemoteOperations([
      {
        type: POSITION_OPERATION_TYPE.Insert,
        index: 0,
        length: 1,
        text: "X",
      },
    ]);
    adapter.applyRemoteOperations([
      {
        type: POSITION_OPERATION_TYPE.Insert,
        index: 1,
        length: 1,
        text: "Y",
      },
    ]);
    expect(textarea.value).toBe("hello");

    // Composition commits 你 between "he" and "llo".
    textarea.value = "he你llo";
    textarea.dispatchEvent(new Event("compositionend"));

    // Both peer ops replayed first → baseline becomes "XYhello"; the
    // composition diff then targets index 4 in that baseline.
    expect(textarea.value).toBe("XYhe你llo");
    expect(received).toEqual([
      [
        {
          type: POSITION_OPERATION_TYPE.Insert,
          index: 4,
          length: 1,
          text: "你",
        },
      ],
    ]);
    adapter.destroy();
  });

  it("flushes the buffered peer ops on blur when compositionend never fires", () => {
    const textarea = mountTextarea("hello");
    const adapter = createTextareaAdapter(textarea);

    textarea.dispatchEvent(new Event("compositionstart"));
    adapter.applyRemoteOperations([
      {
        type: POSITION_OPERATION_TYPE.Insert,
        index: 0,
        length: 1,
        text: "X",
      },
    ]);
    // Mobile-IME case: focus yanked before compositionend dispatches.
    textarea.dispatchEvent(new Event("blur"));

    expect(textarea.value).toBe("Xhello");
    adapter.destroy();
  });

  it("leaves the DOM untouched when buffered peer ops are semantic no-ops", () => {
    const textarea = mountTextarea("hello");
    const adapter = createTextareaAdapter(textarea);
    const received: TextareaOperation[][] = [];
    adapter.observeLocalOperations((ops) => received.push([...ops]));

    textarea.dispatchEvent(new Event("compositionstart"));
    adapter.applyRemoteOperations([
      { type: POSITION_OPERATION_TYPE.Delete, index: 1, length: 0 },
    ]);
    textarea.value = "hello!";
    textarea.dispatchEvent(new Event("compositionend"));

    expect(textarea.value).toBe("hello!");
    expect(received).toEqual([
      [
        {
          type: POSITION_OPERATION_TYPE.Insert,
          index: 5,
          length: 1,
          text: "!",
        },
      ],
    ]);
    adapter.destroy();
  });

  it("ignores an empty operation batch", () => {
    const textarea = mountTextarea("hello");
    const adapter = createTextareaAdapter(textarea);
    textarea.focus();
    textarea.setSelectionRange(2, 2);

    adapter.applyRemoteOperations([]);

    expect(textarea.value).toBe("hello");
    expect(textarea.selectionStart).toBe(2);
    adapter.destroy();
  });

  it("treats a remote batch with no visible effect as a baseline-only update", () => {
    // A delete-then-reinsert of the same characters produces
    // `nextValue === previousValue`, exercising the no-op early-return
    // branch that updates `lastValue` without touching the DOM or
    // selection.
    const textarea = mountTextarea("hello");
    const adapter = createTextareaAdapter(textarea);
    const received: TextareaOperation[][] = [];
    adapter.observeLocalOperations((ops) => received.push([...ops]));
    textarea.focus();
    textarea.setSelectionRange(1, 4, "forward");

    adapter.applyRemoteOperations([
      { type: POSITION_OPERATION_TYPE.Delete, index: 2, length: 2 },
      {
        type: POSITION_OPERATION_TYPE.Insert,
        index: 2,
        length: 2,
        text: "ll",
      },
    ]);

    expect(textarea.value).toBe("hello");
    expect(textarea.selectionStart).toBe(1);
    expect(textarea.selectionEnd).toBe(4);
    expect(received).toEqual([]);
    adapter.destroy();
  });
});

describe("createTextareaAdapter — selection helpers", () => {
  it("captures the current DOM selection", () => {
    const textarea = mountTextarea("hello");
    const adapter = createTextareaAdapter(textarea);
    textarea.focus();
    textarea.setSelectionRange(1, 4, "forward");

    expect(adapter.getSelection()).toEqual({
      selectionStart: 1,
      selectionEnd: 4,
      selectionDirection: "forward",
    });
    adapter.destroy();
  });

  it("normalizes unsupported DOM selection directions to none", () => {
    const textarea = mountTextarea("hello");
    Object.defineProperty(textarea, "selectionDirection", {
      configurable: true,
      get: () => "sideways",
    });
    const adapter = createTextareaAdapter(textarea);

    expect(adapter.getSelection()?.selectionDirection).toBe("none");
    adapter.destroy();
  });

  it("restores a selection, clamping to the current value length", () => {
    const textarea = mountTextarea("hello");
    const adapter = createTextareaAdapter(textarea);
    textarea.focus();

    adapter.restoreSelection({
      selectionStart: 99,
      selectionEnd: 99,
      selectionDirection: "none",
    });

    expect(textarea.selectionStart).toBe(5);
    expect(textarea.selectionEnd).toBe(5);
    adapter.destroy();
  });

  it("flips direction when restoreSelection receives reversed endpoints", () => {
    const textarea = mountTextarea("hello");
    const adapter = createTextareaAdapter(textarea);
    textarea.focus();

    adapter.restoreSelection({
      selectionStart: 5,
      selectionEnd: 1,
      selectionDirection: "forward",
    });
    expect(textarea.selectionStart).toBe(1);
    expect(textarea.selectionEnd).toBe(5);
    expect(textarea.selectionDirection).toBe("backward");

    adapter.restoreSelection({
      selectionStart: 4,
      selectionEnd: 2,
      selectionDirection: "backward",
    });
    expect(textarea.selectionStart).toBe(2);
    expect(textarea.selectionEnd).toBe(4);
    expect(textarea.selectionDirection).toBe("forward");

    adapter.restoreSelection({
      selectionStart: 3,
      selectionEnd: 1,
    });
    expect(textarea.selectionStart).toBe(1);
    expect(textarea.selectionEnd).toBe(3);
    expect(textarea.selectionDirection).toBe("none");
    adapter.destroy();
  });

  it("maps a selection through an operation batch without touching the DOM", () => {
    const textarea = mountTextarea("hello");
    const adapter = createTextareaAdapter(textarea);
    textarea.focus();
    textarea.setSelectionRange(2, 2);

    const mapped = adapter.mapSelectionThroughOperations(
      { selectionStart: 3, selectionEnd: 3, selectionDirection: "none" },
      [
        {
          type: POSITION_OPERATION_TYPE.Insert,
          index: 1,
          length: 2,
          text: "XX",
        },
      ],
    );

    expect(mapped.selectionStart).toBe(5);
    expect(mapped.selectionEnd).toBe(5);
    // DOM selection unchanged.
    expect(textarea.selectionStart).toBe(2);
    adapter.destroy();
  });
});

describe("createTextareaAdapter — lifecycle", () => {
  it("removes DOM listeners on destroy", () => {
    const textarea = mountTextarea("");
    const adapter = createTextareaAdapter(textarea);
    const received: TextareaOperation[][] = [];
    adapter.observeLocalOperations((ops) => received.push([...ops]));

    adapter.destroy();
    fireInput(textarea, "hello");

    expect(received).toEqual([]);
  });

  it("returns a disposer that removes a single subscriber", () => {
    const textarea = mountTextarea("");
    const adapter = createTextareaAdapter(textarea);
    const a: TextareaOperation[][] = [];
    const b: TextareaOperation[][] = [];
    const unsubscribeA = adapter.observeLocalOperations((ops) =>
      a.push([...ops]),
    );
    adapter.observeLocalOperations((ops) => b.push([...ops]));

    unsubscribeA();
    fireInput(textarea, "hi");

    expect(a).toEqual([]);
    expect(b).toHaveLength(1);
    adapter.destroy();
  });

  it("is safe to destroy twice", () => {
    const textarea = mountTextarea("");
    const adapter = createTextareaAdapter(textarea);
    adapter.destroy();
    expect(() => adapter.destroy()).not.toThrow();
  });

  it("ignores applyRemoteOperations after destroy", () => {
    const textarea = mountTextarea("hello");
    const adapter = createTextareaAdapter(textarea);
    adapter.destroy();
    adapter.applyRemoteOperations([
      {
        type: POSITION_OPERATION_TYPE.Insert,
        index: 5,
        length: 1,
        text: "!",
      },
    ]);
    expect(textarea.value).toBe("hello");
  });

  it("returns null from getSelection after destroy without throwing", () => {
    const textarea = mountTextarea("hello");
    const adapter = createTextareaAdapter(textarea);
    textarea.focus();
    textarea.setSelectionRange(1, 3);
    adapter.destroy();

    expect(() => adapter.getSelection()).not.toThrow();
    expect(adapter.getSelection()).toBeNull();
  });

  it("treats restoreSelection after destroy as a no-op without throwing", () => {
    const textarea = mountTextarea("hello");
    const adapter = createTextareaAdapter(textarea);
    textarea.focus();
    textarea.setSelectionRange(2, 2);
    adapter.destroy();

    expect(() =>
      adapter.restoreSelection({
        selectionStart: 0,
        selectionEnd: 5,
        selectionDirection: "none",
      }),
    ).not.toThrow();
    // Selection unchanged: destroy left the DOM alone, just stopped
    // mediating it.
    expect(textarea.selectionStart).toBe(2);
    expect(textarea.selectionEnd).toBe(2);
  });

  it("refuses new subscriptions after destroy and returns a no-op disposer", () => {
    const textarea = mountTextarea("");
    const adapter = createTextareaAdapter(textarea);
    adapter.destroy();
    const lateSubscriber = vi.fn();
    const dispose = adapter.observeLocalOperations(lateSubscriber);

    expect(() => dispose()).not.toThrow();
    // Input events can't reach a destroyed adapter (listeners are
    // removed), but assert the contract explicitly: a late subscriber
    // is never invoked.
    textarea.value = "x";
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    expect(lateSubscriber).not.toHaveBeenCalled();
  });

  it("applyLocalOperation is a no-op (DOM is canonical for local edits)", () => {
    const textarea = mountTextarea("hello");
    const adapter = createTextareaAdapter(textarea);
    adapter.applyLocalOperation({
      type: POSITION_OPERATION_TYPE.Insert,
      index: 0,
      length: 1,
      text: "X",
    });
    expect(textarea.value).toBe("hello");
    adapter.destroy();
  });

  it("exposes the live textarea value via getDocumentSnapshot", () => {
    const textarea = mountTextarea("initial");
    const adapter = createTextareaAdapter(textarea);
    expect(adapter.getDocumentSnapshot()).toBe("initial");
    fireInput(textarea, "updated");
    expect(adapter.getDocumentSnapshot()).toBe("updated");
    adapter.destroy();
  });
});
