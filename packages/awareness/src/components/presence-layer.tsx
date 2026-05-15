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

const PresenceLayerContext = createContext<PresenceLayerOffset | null>(null);

/**
 * Read the current host offset injected by the nearest `<PresenceLayer>`
 * ancestor. Returns `null` outside a layer — components that consume this
 * should treat that as "use coordinates as-is" so they keep working when
 * rendered standalone (e.g. in stories or one-off overlays).
 */
export const usePresenceLayerOffset = (): PresenceLayerOffset | null =>
  useContext(PresenceLayerContext);

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

/**
 * Fixed-position overlay aligned to a host element. Owns the
 * `getBoundingClientRect` tracking (ResizeObserver + scroll/resize) so
 * consumers don't have to wire it themselves — the bug class where a
 * presence overlay anchored to the wrong element pushes cursors and
 * selections off the line goes away once everything inside the layer
 * uses host-local coordinates.
 *
 * The layer renders nothing visible until the host has been measured;
 * this avoids a one-frame flash at (0,0) before the first layout pass.
 */
export const PresenceLayer = ({
  host,
  children,
  className,
}: PresenceLayerProps): ReactNode => {
  const [offset, setOffset] = useState<PresenceLayerOffset | null>(null);

  useLayoutEffect(() => {
    const el = host.current;
    if (!el) return;

    const update = (): void => {
      const rect = el.getBoundingClientRect();
      setOffset((prev) =>
        prev !== null && prev.left === rect.left && prev.top === rect.top
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

  if (!offset) return null;

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
