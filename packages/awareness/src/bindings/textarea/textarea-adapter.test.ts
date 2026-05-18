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

  it("skips the write while composing", () => {
    const textarea = mountTextarea("hello");
    const adapter = createTextareaAdapter(textarea);

    textarea.dispatchEvent(new Event("compositionstart"));
    adapter.applyRemoteOperations([
      {
        type: POSITION_OPERATION_TYPE.Insert,
        index: 5,
        length: 1,
        text: "!",
      },
    ]);

    expect(textarea.value).toBe("hello");
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
