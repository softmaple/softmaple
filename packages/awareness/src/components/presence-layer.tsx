import {
  createContext,
  type ReactNode,
  type RefObject,
  useContext,
  useLayoutEffect,
  useState,
} from "react";
import { cx } from "./internal-utils";

export interface PresenceLayerOffset {
  readonly left: number;
  readonly top: number;
}

/**
 * The context that `<PresenceLayer>` populates with the host's bounding
 * offset. Exposed so unit tests can inject a fixed offset without going
 * through `useLayoutEffect`-based measurement (which doesn't run under
 * SSR / `renderToStaticMarkup`). Prefer `<PresenceLayer>` in real apps.
 */
export const PresenceLayerContext = createContext<PresenceLayerOffset | null>(
  null,
);

/**
 * Read the current host offset injected by the nearest `<PresenceLayer>`
 * ancestor. Returns `null` when no layer is in scope; the consumer
 * should treat that as a misuse and either render nothing or fall back
 * loudly (see `warnMissingPresenceLayerOnce`).
 */
export const usePresenceLayerOffset = (): PresenceLayerOffset | null =>
  useContext(PresenceLayerContext);

const warnedComponents = new Set<string>();

/**
 * Logs a single dev-mode warning the first time a given component is
 * rendered without a `<PresenceLayer>` ancestor. Stripped from
 * production bundles by the standard `process.env.NODE_ENV` check.
 */
export const warnMissingPresenceLayerOnce = (componentName: string): void => {
  if (
    typeof process === "undefined" ||
    process.env.NODE_ENV === "production" ||
    warnedComponents.has(componentName)
  ) {
    return;
  }
  warnedComponents.add(componentName);
  console.warn(
    `[@softmaple/awareness] <${componentName}> was rendered without a <PresenceLayer> ancestor and will not render. Wrap it in <PresenceLayer host={ref}> so coordinates can be translated against a host element.`,
  );
};

export interface PresenceLayerProps {
  /**
   * The element overlay coordinates are measured against. Children pass
   * `point`/`rect` values whose `x`/`y` are relative to this element's
   * top-left.
   *
   * By default the layer assumes those coordinates already account for
   * the host's internal scroll (the consumer subtracted `host.scrollLeft`
   * / `scrollTop`). Pass `trackHostScroll` to flip that contract — see
   * the prop doc for details.
   */
  readonly host: RefObject<HTMLElement | null>;
  readonly children?: ReactNode;
  readonly className?: string;
  /**
   * When `true`, the layer also subscribes to the host's `scroll`
   * events and folds `host.scrollLeft` / `scrollTop` into the offset.
   * Children can then pass *content-relative* coordinates (i.e. the
   * raw values from `getTextareaSelectionRects` and friends) and the
   * layer will move them with the host's scroll automatically.
   *
   * When `false` (default), the layer only tracks the host's bounding
   * rect in viewport space. Children must subtract
   * `host.scrollLeft` / `scrollTop` themselves and re-emit their
   * coordinates when the host scrolls — appropriate for hosts that
   * never scroll, or for editors with their own selection model that
   * already feed in viewport-relative values.
   */
  readonly trackHostScroll?: boolean;
}

// Identity offset used until the host is measured. Rendering with this
// value (rather than waiting for the first useLayoutEffect tick) means
// children mount on the first commit, which keeps refs and effects
// inside the layer (e.g. `useEffect` in `LiveCursor`) wired up
// predictably. The layer corrects the offset on the same paint via
// `useLayoutEffect`, so there's no visible flicker.
const IDENTITY_OFFSET: PresenceLayerOffset = { left: 0, top: 0 };

/**
 * Fixed-position overlay aligned to a host element. Owns the
 * `getBoundingClientRect` tracking (ResizeObserver + scroll/resize) so
 * consumers don't have to wire it themselves — the bug class where a
 * presence overlay anchored to the wrong element pushes cursors and
 * selections off the line goes away once everything inside the layer
 * uses host-local coordinates.
 *
 * By default the layer tracks the host's **position** (its bounding
 * rect in viewport space) but ignores host-internal scrolling —
 * `getBoundingClientRect` doesn't change when a textarea or scroll
 * container scrolls its own content. Pass `trackHostScroll` to also
 * subscribe to the host's `scroll` events and fold its `scrollLeft` /
 * `scrollTop` into the offset; children can then pass
 * content-relative coordinates without subtracting scroll themselves.
 */
export const PresenceLayer = ({
  host,
  children,
  className,
  trackHostScroll = false,
}: PresenceLayerProps): ReactNode => {
  const [offset, setOffset] = useState<PresenceLayerOffset>(IDENTITY_OFFSET);

  useLayoutEffect(() => {
    const update = (): void => {
      const el = host.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      // When `trackHostScroll` is on, subtract the host's internal
      // scroll so that content-relative children coordinates land in
      // the right place. When it's off, the offset is purely the
      // host's viewport position — children own scroll subtraction.
      const left = trackHostScroll ? rect.left - el.scrollLeft : rect.left;
      const top = trackHostScroll ? rect.top - el.scrollTop : rect.top;
      setOffset((prev) =>
        prev.left === left && prev.top === top ? prev : { left, top },
      );
    };

    let ro: ResizeObserver | null = null;
    let rafId = 0;

    const attach = (): void => {
      const el = host.current;
      if (!el) return;
      update();
      // ResizeObserver is missing in jsdom and older SSR environments —
      // the scroll/resize listeners below cover the most common cases
      // even when it's unavailable.
      if (typeof ResizeObserver !== "undefined") {
        ro = new ResizeObserver(update);
        ro.observe(el);
      }
    };

    // Layout effects fire bottom-up, so when the host ref points to an
    // ancestor of `<PresenceLayer>` (e.g. a parent surface div with
    // `ref={surfaceRef}` that wraps the layer), the ancestor's ref
    // hasn't been attached yet at this point and `host.current` is
    // `null`. `requestAnimationFrame` defers until after the current
    // commit completes — by then every ref in the tree is attached.
    if (host.current) {
      attach();
    } else {
      rafId = requestAnimationFrame(attach);
    }

    // Capture-phase scroll catches scrolls in any ancestor (the host can
    // sit inside an arbitrary scroll container the consumer owns) AND
    // the host element itself when it scrolls its own content —
    // capture-phase scroll events from the host bubble up through the
    // window in capture phase too, so this single listener covers both.
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      if (rafId !== 0) cancelAnimationFrame(rafId);
      ro?.disconnect();
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [host, trackHostScroll]);

  return (
    <PresenceLayerContext.Provider value={offset}>
      {/*
       * Intentionally not `aria-hidden` — the cursors and selections inside
       * carry their own aria-labels ("Pikachu cursor", "Charmander
       * selection: ...") that assistive tech should be able to announce on
       * hover or focus. Hiding the whole subtree at the layer level would
       * silence those.
       */}
      <div className={cx("awareness-presence-layer", className)}>
        {children}
      </div>
    </PresenceLayerContext.Provider>
  );
};
