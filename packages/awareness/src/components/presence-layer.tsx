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
   * top-left in viewport coordinates (i.e., already adjusted for any
   * internal scroll the host has). The layer adds the host's bounding
   * rect so children render in the right place.
   */
  readonly host: RefObject<HTMLElement | null>;
  readonly children?: ReactNode;
  readonly className?: string;
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
 * Contract: the layer tracks the host's **position** (its bounding
 * rect in viewport space). It does *not* observe host-internal
 * scrolling — `getBoundingClientRect` doesn't change when a textarea
 * or scroll container scrolls its own content. Consumers that produce
 * host-local `point`/`rect` values must subtract `host.scrollLeft` /
 * `host.scrollTop` themselves (see `EditorSurface.pointFor` for the
 * pattern), and must re-emit those values when the host scrolls if
 * the underlying caret/selection didn't move.
 */
export const PresenceLayer = ({
  host,
  children,
  className,
}: PresenceLayerProps): ReactNode => {
  const [offset, setOffset] = useState<PresenceLayerOffset>(IDENTITY_OFFSET);

  useLayoutEffect(() => {
    const el = host.current;
    if (!el) return;

    const update = (): void => {
      const rect = el.getBoundingClientRect();
      setOffset((prev) =>
        prev.left === rect.left && prev.top === rect.top
          ? prev
          : { left: rect.left, top: rect.top },
      );
    };
    update();

    // ResizeObserver is missing in jsdom and older SSR environments —
    // the scroll/resize listeners below cover the most common cases
    // even when it's unavailable.
    const ro =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null;
    ro?.observe(el);
    // Capture-phase scroll catches scrolls in any ancestor (the host can
    // sit inside an arbitrary scroll container the consumer owns).
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      ro?.disconnect();
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [host]);

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
