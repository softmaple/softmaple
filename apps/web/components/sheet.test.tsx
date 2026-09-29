// @vitest-environment jsdom
import { act, type ReactNode, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
  type SheetContentProps,
} from "@softmaple/ui/components/sheet";

function Harness({
  controlled = false,
  rejectDismissal = false,
  onOpenChange,
  children,
  ...props
}: SheetContentProps & {
  controlled?: boolean;
  rejectDismissal?: boolean;
  onOpenChange?: (open: boolean) => void;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(true);
  return (
    <Sheet
      defaultOpen
      open={controlled ? open : undefined}
      onOpenChange={(value) => {
        onOpenChange?.(value);
        if (!rejectDismissal) setOpen(value);
      }}
    >
      <SheetTrigger>Open sheet</SheetTrigger>
      <SheetContent side="bottom" {...props}>
        <SheetTitle>Navigation</SheetTitle>
        <SheetDescription>Choose a destination</SheetDescription>
        {children ?? <p data-testid="body">Swipe down to dismiss</p>}
      </SheetContent>
    </Sheet>
  );
}

function sheet() {
  const element = document.querySelector<HTMLDivElement>(
    '[data-slot="sheet-content"]',
  );
  if (!element) throw new Error("Expected an open sheet");
  return element;
}

function handle() {
  const element = sheet().querySelector<HTMLButtonElement>(
    '[data-slot="sheet-handle"]',
  );
  if (!element) throw new Error("Expected a sheet handle");
  return element;
}

function touch(
  target: Element,
  type: string,
  y: number,
  time: number,
  x = 100,
) {
  const point = { identifier: 1, clientX: x, clientY: y };
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    touches: {
      value: type === "touchend" || type === "touchcancel" ? [] : [point],
    },
    changedTouches: { value: [point] },
    timeStamp: { value: time },
  });
  act(() => target.dispatchEvent(event));
  return event;
}

function pointer(target: Element, type: string, y: number, time: number) {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: 100,
    clientY: y,
    button: 0,
  });
  Object.defineProperties(event, {
    pointerId: { value: 1 },
    pointerType: { value: "mouse" },
    timeStamp: { value: time },
  });
  act(() => target.dispatchEvent(event));
}

describe("bottom sheet interaction", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: false })),
    );
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 200, 390, 400),
    );
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it.each([
    false,
    true,
  ])("follows the finger and dismisses a long drag (controlled=%s)", (controlled) => {
    const onOpenChange = vi.fn();
    act(() =>
      root.render(
        <Harness controlled={controlled} onOpenChange={onOpenChange} />,
      ),
    );
    const grabber = handle();
    touch(grabber, "touchstart", 100, 0);
    expect(touch(grabber, "touchmove", 180, 100).defaultPrevented).toBe(true);
    expect(sheet().style.translate).toBe("0 80px");
    touch(grabber, "touchmove", 260, 200);
    touch(grabber, "touchend", 260, 250);
    expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false);
    expect(document.querySelector('[data-slot="sheet-content"]')).toBeNull();
  });

  it("dismisses a short, fast downward flick", () => {
    act(() => root.render(<Harness />));
    const grabber = handle();
    touch(grabber, "touchstart", 100, 0);
    touch(grabber, "touchmove", 145, 30);
    touch(grabber, "touchend", 150, 40);
    expect(document.querySelector('[data-slot="sheet-content"]')).toBeNull();
  });

  it("snaps back a short drag and suppresses the resulting pointer click", () => {
    act(() => root.render(<Harness />));
    const grabber = handle();
    touch(grabber, "touchstart", 100, 0);
    touch(grabber, "touchmove", 135, 200);
    touch(grabber, "touchend", 135, 400);
    expect(sheet().style.translate).toBe("0 0");
    const click = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      detail: 1,
    });
    act(() => grabber.dispatchEvent(click));
    expect(click.defaultPrevented).toBe(true);
    expect(sheet()).toBeTruthy();
    // The accessible button continues to respond to keyboard activation.
    act(() => grabber.click());
    expect(document.querySelector('[data-slot="sheet-content"]')).toBeNull();
  });

  it("snaps back a cancelled gesture even after the dismissal threshold", () => {
    act(() => root.render(<Harness />));
    const grabber = handle();
    touch(grabber, "touchstart", 100, 0);
    touch(grabber, "touchmove", 290, 100);
    touch(grabber, "touchcancel", 290, 120);
    expect(sheet().style.translate).toBe("0 0");
  });

  // Radix also prevents touchmove for its body scroll lock. jsdom has no layout;
  // native scrolling is covered by the mobile Playwright test. Here, verify
  // that sheet dragging never takes ownership of these gestures.
  it("keeps upward and horizontal swipes available to the page content", () => {
    act(() => root.render(<Harness />));
    const body = sheet().querySelector("p")!;
    touch(body, "touchstart", 100, 0);
    touch(body, "touchmove", 60, 100);
    expect(sheet().dataset.dragging).toBeUndefined();
    touch(body, "touchend", 60, 200);
    touch(body, "touchstart", 100, 300);
    touch(body, "touchmove", 110, 400, 170);
    expect(sheet().dataset.dragging).toBeUndefined();
    expect(sheet().style.translate).toBe("");
  });

  it("scrolls nested content before allowing a new drag at its top", () => {
    act(() =>
      root.render(
        <Harness>
          <div data-testid="scroll">
            <p>Long content</p>
          </div>
        </Harness>,
      ),
    );
    const scroller = sheet().querySelector<HTMLDivElement>(
      '[data-testid="scroll"]',
    )!;
    const body = scroller.querySelector("p")!;
    scroller.scrollTop = 80;
    touch(body, "touchstart", 100, 0);
    touch(body, "touchmove", 200, 100);
    expect(sheet().dataset.dragging).toBeUndefined();
    scroller.scrollTop = 0;
    touch(body, "touchmove", 250, 200);
    expect(sheet().dataset.dragging).toBeUndefined();
    touch(body, "touchend", 250, 300);
    touch(body, "touchstart", 100, 400);
    expect(touch(body, "touchmove", 140, 600).defaultPrevented).toBe(true);
    expect(sheet().style.translate).toBe("0 40px");
  });

  it("leaves inputs, links, and opted-out controls interactive", () => {
    act(() =>
      root.render(
        <Harness>
          <input />
          <a href="#destination">Destination</a>
          <div data-sheet-no-drag>Custom control</div>
        </Harness>,
      ),
    );
    for (const control of sheet().querySelectorAll(
      "input, a, [data-sheet-no-drag]",
    )) {
      touch(control, "touchstart", 100, 0);
      touch(control, "touchmove", 250, 100);
      expect(sheet().dataset.dragging).toBeUndefined();
      touch(control, "touchend", 250, 200);
    }
    expect(sheet().style.translate).toBe("");
  });

  it("supports mouse dragging while retaining a simple tap to close", () => {
    act(() => root.render(<Harness />));
    const grabber = handle();
    pointer(grabber, "pointerdown", 100, 0);
    pointer(grabber, "pointermove", 180, 200);
    expect(sheet().style.translate).toBe("0 80px");
    pointer(grabber, "pointercancel", 180, 300);
    expect(sheet().style.translate).toBe("0 0");
    pointer(grabber, "pointerdown", 100, 400);
    pointer(grabber, "pointerup", 100, 410);
    act(() =>
      grabber.dispatchEvent(
        new MouseEvent("click", { bubbles: true, detail: 1 }),
      ),
    );
    expect(document.querySelector('[data-slot="sheet-content"]')).toBeNull();
  });

  it("preserves side sheets and Escape dismissal", () => {
    act(() => root.render(<Harness side="right" />));
    const body = sheet().querySelector("p")!;
    touch(body, "touchstart", 100, 0);
    touch(body, "touchmove", 280, 100);
    expect(sheet().dataset.dragging).toBeUndefined();
    expect(sheet().style.translate).toBe("");
    act(() =>
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      ),
    );
    expect(document.querySelector('[data-slot="sheet-content"]')).toBeNull();
  });

  it("respects reduced motion when snapping back", () => {
    vi.mocked(window.matchMedia).mockImplementation(
      (query) =>
        ({
          matches: query.includes("prefers-reduced-motion"),
        }) as MediaQueryList,
    );
    act(() => root.render(<Harness />));
    const grabber = handle();
    touch(grabber, "touchstart", 100, 0);
    touch(grabber, "touchmove", 135, 100);
    touch(grabber, "touchcancel", 135, 200);
    expect(sheet().style.transition).toBe("none");
  });

  it("avoids opening the touch keyboard automatically for a handle-free form", () => {
    vi.mocked(window.matchMedia).mockImplementation(
      (query) =>
        ({ matches: query.includes("pointer: coarse") }) as MediaQueryList,
    );
    act(() =>
      root.render(
        <Harness showHandle={false}>
          <input aria-label="Name" />
        </Harness>,
      ),
    );
    expect(document.activeElement).toBe(sheet());
  });

  it("keeps the sheet within the visual viewport when the software keyboard opens", () => {
    const viewport = Object.assign(new EventTarget(), {
      height: 700,
      offsetTop: 0,
      scale: 1,
    });
    vi.stubGlobal("visualViewport", viewport);
    vi.stubGlobal("innerHeight", 800);
    act(() => root.render(<Harness />));
    expect(sheet().style.getPropertyValue("--sheet-viewport-height")).toBe(
      "700px",
    );
    viewport.height = 380;
    act(() => viewport.dispatchEvent(new Event("resize")));
    expect(sheet().style.getPropertyValue("--sheet-viewport-height")).toBe(
      "380px",
    );
    expect(sheet().style.getPropertyValue("--sheet-viewport-bottom")).toBe(
      "420px",
    );
  });
});
