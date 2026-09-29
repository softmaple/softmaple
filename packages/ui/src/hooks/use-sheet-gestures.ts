"use client";

import * as React from "react";

type Point = { x: number; y: number; time: number };
type Gesture = {
  id: number;
  start: Point;
  samples: Point[];
  distance: number;
  dragging: boolean;
};

const interactiveSelector =
  'a, button, input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="button"], [role="slider"], [data-sheet-no-drag]';

function canStartDrag(target: EventTarget | null, content: HTMLElement) {
  if (!(target instanceof Element)) return false;
  if (target.closest('[data-slot="sheet-handle"]')) return true;
  if (target.closest(interactiveSelector)) return false;
  if (window.getSelection()?.toString()) return false;

  // A downward swipe in scrolled content must scroll back to its beginning.
  // Do not take over that gesture halfway through and accidentally dismiss.
  for (let node: Element | null = target; node; node = node.parentElement) {
    if (node.scrollTop > 0) return false;
    if (node === content) break;
  }
  return true;
}

/** Keep frame-by-frame motion outside React; Radix still owns dismissal/focus. */
export function useSheetGestures(
  content: HTMLDivElement | null,
  enabled: boolean,
  onDismiss: () => void,
) {
  const dismiss = React.useEffectEvent(onDismiss);

  React.useEffect(() => {
    if (!enabled || !content) return;

    let gesture: Gesture | null = null;
    let suppressClickUntil = 0;
    let resetTimer: ReturnType<typeof setTimeout> | undefined;
    let dismissalFrame = 0;
    const original = {
      translate: content.style.translate,
      transition: content.style.transition,
    };

    const restore = () => {
      content.style.translate = original.translate;
      content.style.transition = original.transition;
      delete content.dataset.dragging;
    };

    const settle = () => {
      const reducedMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;
      content.style.transition = reducedMotion
        ? "none"
        : "translate 220ms cubic-bezier(0.22, 1, 0.36, 1)";
      content.style.translate = original.translate || "0 0";
      resetTimer = setTimeout(restore, reducedMotion ? 0 : 220);
    };

    const start = (id: number, point: Point, target: EventTarget | null) => {
      if (!canStartDrag(target, content)) return;
      clearTimeout(resetTimer);
      cancelAnimationFrame(dismissalFrame);
      restore();
      suppressClickUntil = 0;
      gesture = {
        id,
        start: point,
        samples: [point],
        distance: 0,
        dragging: false,
      };
    };

    const move = (point: Point) => {
      if (!gesture) return false;
      const dx = point.x - gesture.start.x;
      const dy = point.y - gesture.start.y;
      if (!gesture.dragging) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) < 6) return false;
        suppressClickUntil = performance.now() + 500;
        if (dy <= 0 || Math.abs(dx) > dy) {
          gesture = null;
          return false;
        }
        gesture.dragging = true;
        content.dataset.dragging = "true";
        content.style.transition = "none";
      }
      gesture.distance = Math.max(0, dy);
      gesture.samples = [
        ...gesture.samples.filter((p) => point.time - p.time < 100),
        point,
      ];
      content.style.translate = `0 ${gesture.distance}px`;
      return true;
    };

    const finish = (point: Point | undefined, cancelled = false) => {
      const current = gesture;
      gesture = null;
      if (!current?.dragging) return;
      suppressClickUntil = performance.now() + 500;
      const latest = point ?? current.samples[current.samples.length - 1]!;
      const oldest = current.samples.find((p) => latest.time - p.time <= 100);
      const velocity = oldest
        ? (latest.y - oldest.y) / Math.max(1, latest.time - oldest.time)
        : 0;
      const threshold = Math.max(
        64,
        Math.min(120, content.getBoundingClientRect().height * 0.3),
      );
      const shouldDismiss =
        !cancelled &&
        (current.distance >= threshold ||
          (current.distance >= 32 && velocity > 0.55));

      if (!shouldDismiss) {
        settle();
        return;
      }
      // Keep the current offset during Radix's exit animation to avoid a jump.
      dismiss();
      dismissalFrame = requestAnimationFrame(() => {
        // A controlled owner can reject dismissal (for example while saving).
        if (content.dataset.state === "open") settle();
      });
    };

    const pointerPoint = (event: PointerEvent): Point => ({
      x: event.clientX,
      y: event.clientY,
      time: event.timeStamp,
    });
    const pointerDown = (event: PointerEvent) => {
      if (event.pointerType === "touch" || event.button !== 0) return;
      if (!(event.target instanceof Element)) return;
      if (
        !event.target.closest(
          '[data-slot="sheet-handle"], [data-slot="sheet-header"]',
        )
      )
        return;
      start(event.pointerId, pointerPoint(event), event.target);
      if (gesture) event.target.setPointerCapture?.(event.pointerId);
    };
    const pointerMove = (event: PointerEvent) => {
      if (event.pointerType === "touch" || gesture?.id !== event.pointerId)
        return;
      if (move(pointerPoint(event))) event.preventDefault();
    };
    const pointerUp = (event: PointerEvent) => {
      if (event.pointerType === "touch" || gesture?.id !== event.pointerId)
        return;
      finish(pointerPoint(event), event.type !== "pointerup");
    };
    const touchPoint = (touch: Touch, event: TouchEvent): Point => ({
      x: touch.clientX,
      y: touch.clientY,
      time: event.timeStamp,
    });
    const touchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) {
        finish(undefined, true);
        return;
      }
      const touch = event.touches[0]!;
      start(touch.identifier, touchPoint(touch, event), event.target);
    };
    const touchMove = (event: TouchEvent) => {
      if (!gesture) return;
      const touch = Array.from(event.touches).find(
        (t) => t.identifier === gesture?.id,
      );
      if (!touch) return;
      if (!event.cancelable) {
        finish(undefined, true);
        return;
      }
      if (move(touchPoint(touch, event))) event.preventDefault();
    };
    const touchEnd = (event: TouchEvent) => {
      if (!gesture) return;
      const touch = Array.from(event.changedTouches).find(
        (t) => t.identifier === gesture?.id,
      );
      if (touch) finish(touchPoint(touch, event), event.type === "touchcancel");
    };
    const click = (event: MouseEvent) => {
      // Keyboard activation has detail=0 and always retains Close semantics.
      if (event.detail > 0 && performance.now() < suppressClickUntil) {
        event.preventDefault();
        event.stopPropagation();
      }
    };

    content.addEventListener("pointerdown", pointerDown);
    content.addEventListener("pointermove", pointerMove);
    content.addEventListener("pointerup", pointerUp);
    content.addEventListener("pointercancel", pointerUp);
    content.addEventListener("lostpointercapture", pointerUp);
    content.addEventListener("touchstart", touchStart, { passive: true });
    content.addEventListener("touchmove", touchMove, { passive: false });
    content.addEventListener("touchend", touchEnd);
    content.addEventListener("touchcancel", touchEnd);
    content.addEventListener("click", click, true);
    return () => {
      clearTimeout(resetTimer);
      cancelAnimationFrame(dismissalFrame);
      restore();
      content.removeEventListener("pointerdown", pointerDown);
      content.removeEventListener("pointermove", pointerMove);
      content.removeEventListener("pointerup", pointerUp);
      content.removeEventListener("pointercancel", pointerUp);
      content.removeEventListener("lostpointercapture", pointerUp);
      content.removeEventListener("touchstart", touchStart);
      content.removeEventListener("touchmove", touchMove);
      content.removeEventListener("touchend", touchEnd);
      content.removeEventListener("touchcancel", touchEnd);
      content.removeEventListener("click", click, true);
    };
  }, [content, enabled]);
}
