import { describe, expect, it } from "vitest";
import {
  opensSearch,
  type SearchShortcutEvent,
} from "@/components/search-shortcut";

const event = (
  overrides: Partial<SearchShortcutEvent> = {},
): SearchShortcutEvent => ({
  altKey: false,
  ctrlKey: false,
  defaultPrevented: false,
  isComposing: false,
  key: "/",
  metaKey: false,
  repeat: false,
  shiftKey: false,
  target: null,
  ...overrides,
});

const editable = (): Element => {
  const element = document.createElement("div");
  element.setAttribute("contenteditable", "true");
  return element;
};

describe("opensSearch", () => {
  it("claims Cmd+K and Ctrl+K outside text", () => {
    expect(opensSearch(event({ key: "k", metaKey: true }))).toBe(true);
    expect(opensSearch(event({ key: "K", ctrlKey: true }))).toBe(true);
  });

  it("leaves Cmd+K to the editor's link shortcut inside text", () => {
    expect(
      opensSearch(event({ key: "k", metaKey: true, target: editable() })),
    ).toBe(false);
    expect(
      opensSearch(
        event({
          key: "k",
          metaKey: true,
          target: document.createElement("textarea"),
        }),
      ),
    ).toBe(false);
  });

  it("keeps slash working outside text", () => {
    expect(opensSearch(event())).toBe(true);
    expect(opensSearch(event({ target: editable() }))).toBe(false);
  });

  it("ignores an unmodified k, which is just typing", () => {
    expect(opensSearch(event({ key: "k" }))).toBe(false);
  });

  it("ignores slash with a modifier, which means something else", () => {
    expect(opensSearch(event({ key: "/", metaKey: true }))).toBe(false);
  });

  it("declines a repeat, a composition, or an already-handled event", () => {
    expect(opensSearch(event({ key: "k", metaKey: true, repeat: true }))).toBe(
      false,
    );
    expect(
      opensSearch(event({ key: "k", metaKey: true, isComposing: true })),
    ).toBe(false);
    expect(
      opensSearch(event({ key: "k", metaKey: true, defaultPrevented: true })),
    ).toBe(false);
  });

  it("declines extra modifiers, which belong to other shortcuts", () => {
    expect(
      opensSearch(event({ key: "k", metaKey: true, shiftKey: true })),
    ).toBe(false);
    expect(opensSearch(event({ key: "k", metaKey: true, altKey: true }))).toBe(
      false,
    );
  });
});
