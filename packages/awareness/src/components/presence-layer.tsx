import {
  createContext,
  type ReactNode,
  type RefObject,
  useContext,
  useLayoutEffect,
  useRef,
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
 * Absolute-positioned overlay aligned to a host element. Owns the
 * `getBoundingClientRect` tracking (ResizeObserver + scroll/resize) so
 * consumers don't have to wire it themselves — the bug class where a
 * presence overlay anchored to the wrong element pushes cursors and
 * selections off the line goes away once everything inside the layer
 * uses host-local coordinates.
 *
 * The layer renders inline (no portal) as `position: absolute` and
 * stores the **difference** between the host's bounding rect and the
 * layer's own bounding rect. The unnested case — host and layer
 * scrolling together with the page — is the calm path: their relative
 * offset is unchanged, the `setOffset` early-return below skips the
 * re-render entirely, and the browser handles the scroll natively
 * without the one-frame lag a viewport-anchored (`position: fixed`)
 * layer would have to chase via JS. Nested cases where only one of
 * the two scrolls (e.g. host inside a custom scroll container) DO
 * trigger a re-render — that's the price of staying inline.
 *
 * Because the layer renders inline rather than through a portal, its
 * stacking context is whatever surrounds it. Cursors and selections
 * carry `z-20` in the package CSS so they sit above their siblings,
 * but a consumer rendering the layer inside a `<dialog>` or other
 * `z-index: 1000+` overlay needs its own bump.
 *
 * By default the layer tracks the host's **position** but ignores
 * host-internal scrolling — `getBoundingClientRect` doesn't change
 * when a textarea or scroll container scrolls its own content. Pass
 * `trackHostScroll` to also subscribe to the host's `scroll` events
 * and fold its `scrollLeft` / `scrollTop` into the offset; children
 * can then pass content-relative coordinates without subtracting
 * scroll themselves.
 */
export const PresenceLayer = ({
  host,
  children,
  className,
  trackHostScroll = false,
}: PresenceLayerProps): ReactNode => {
  const layerRef = useRef<HTMLDivElement | null>(null);
  const [offset, setOffset] = useState<PresenceLayerOffset>(IDENTITY_OFFSET);

  useLayoutEffect(() => {
    // Host swap (e.g. consumer flips `host` to a different element):
    // reset to identity before measuring so the first frame after the
    // swap doesn't briefly render children at the *previous* host's
    // offset. The measurement below replaces this on the same paint,
    // so there's no visible flicker.
    setOffset((prev) => (prev === IDENTITY_OFFSET ? prev : IDENTITY_OFFSET));

    const update = (): void => {
      const hostEl = host.current;
      const layerEl = layerRef.current;
      if (!hostEl || !layerEl) return;
      const hostRect = hostEl.getBoundingClientRect();
      const layerRect = layerEl.getBoundingClientRect();
      // Offset is the host's position *relative to the layer's own box*.
      // Because the layer is `position: absolute` and lives in the same
      // document flow as the host, `hostRect - layerRect` stays
      // invariant under window scroll: both rects shift by the same
      // amount, so the difference is unchanged and no re-render fires
      // on the scroll listener. The capture-phase listener still runs
      // for nested scroll containers that move only one of the two.
      //
      // When `trackHostScroll` is on, subtract the host's internal
      // scroll so that content-relative children coordinates land in
      // the right place.
      const left =
        hostRect.left -
        layerRect.left -
        (trackHostScroll ? hostEl.scrollLeft : 0);
      const top =
        hostRect.top - layerRect.top - (trackHostScroll ? hostEl.scrollTop : 0);
      setOffset((prev) =>
        prev.left === left && prev.top === top ? prev : { left, top },
      );
    };

    let ro: ResizeObserver | null = null;
    let rafId = 0;

    const attach = (): void => {
      // Clear the deferred handle so cleanup doesn't try to cancel an
      // already-fired rAF — `cancelAnimationFrame` on a stale id is
      // technically a no-op in browsers, but the explicit reset
      // documents the lifecycle.
      rafId = 0;
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
      <div className={cx("awareness-presence-layer", className)} ref={layerRef}>
        {children}
      </div>
    </PresenceLayerContext.Provider>
  );
};
