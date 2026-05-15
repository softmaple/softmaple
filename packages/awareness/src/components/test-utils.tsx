import type { ReactNode } from "react";
import {
  PresenceLayerContext,
  type PresenceLayerOffset,
} from "./presence-layer";

/**
 * Tests that render `LiveCursor` / `SelectionHighlight` via SSR-style
 * `renderToStaticMarkup` can't go through `<PresenceLayer>` (its layout
 * effect doesn't fire under SSR), so they inject the context offset
 * directly. An identity offset `{0, 0}` satisfies the layer-required
 * guard without affecting the structural HTML the tests inspect.
 */
export const IDENTITY_OFFSET: PresenceLayerOffset = { left: 0, top: 0 };

export const InTestLayer = ({
  children,
}: {
  children: ReactNode;
}): ReactNode => (
  <PresenceLayerContext.Provider value={IDENTITY_OFFSET}>
    {children}
  </PresenceLayerContext.Provider>
);
