// @vitest-environment jsdom
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SearchField } from "./search-field";

function Harness() {
  const [query, setQuery] = useState("notes");
  return (
    <SearchField label="Search documents" value={query} onChange={setQuery} />
  );
}

describe("search keyboard shortcuts", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() => root.render(createElement(Harness)));
    vi.spyOn(HTMLElement.prototype, "getClientRects").mockReturnValue(
      Object.assign([new DOMRect()], { item: () => new DOMRect() }),
    );
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it("focuses search with slash and clears its query with Escape", () => {
    const search = container.querySelector("input")!;
    act(() =>
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "/",
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    expect(document.activeElement).toBe(search);
    act(() =>
      search.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    expect(search.value).toBe("");
    expect(document.activeElement).toBe(search);
    expect(container.querySelector("kbd")?.textContent).toBe("/");
  });

  it("keeps its query when Escape ends an IME composition", () => {
    const search = container.querySelector("input")!;
    act(() =>
      search.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          isComposing: true,
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    expect(search.value).toBe("notes");
  });

  it("does not steal slash from a document editor or form field", () => {
    for (const tag of ["input", "textarea", "div"]) {
      const editor = document.createElement(tag);
      if (tag === "div") editor.setAttribute("contenteditable", "true");
      container.append(editor);
      editor.focus();
      const key = new KeyboardEvent("keydown", {
        key: "/",
        bubbles: true,
        cancelable: true,
      });
      act(() => editor.dispatchEvent(key));
      expect(document.activeElement).toBe(editor);
      expect(key.defaultPrevented).toBe(false);
      editor.remove();
    }
  });

  it("ignores hidden sidebars, modal-hidden content, and modified keys", () => {
    const search = container.querySelector("input")!;
    for (const options of [
      { ctrlKey: true },
      { metaKey: true },
      { altKey: true },
      { isComposing: true },
    ]) {
      act(() =>
        document.dispatchEvent(
          new KeyboardEvent("keydown", { key: "/", ...options }),
        ),
      );
      expect(document.activeElement).not.toBe(search);
    }
    container.setAttribute("aria-hidden", "true");
    act(() =>
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "/" })),
    );
    expect(document.activeElement).not.toBe(search);
    container.removeAttribute("aria-hidden");
    vi.mocked(HTMLElement.prototype.getClientRects).mockReturnValue(
      Object.assign([], { item: () => null }),
    );
    act(() =>
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "/" })),
    );
    expect(document.activeElement).not.toBe(search);
  });
});
