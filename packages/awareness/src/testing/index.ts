/**
 * Testing helpers for `@softmaple/awareness`. These are exposed on a
 * separate subpath (`@softmaple/awareness/testing`) so they don't show
 * up in production autocomplete for the main entry — `PresenceLayerContext`
 * is intentionally a backdoor that lets tests inject a fixed offset
 * without going through `useLayoutEffect`-based measurement (which
 * doesn't run under SSR / `renderToStaticMarkup`).
 *
 * Real apps should always render their overlays through `<PresenceLayer>`
 * and let it own the host-rect tracking. If you find yourself reaching
 * for this module outside of tests, you almost certainly want
 * `<PresenceLayer host={ref}>` instead.
 */

export {
  PresenceLayerContext,
  type PresenceLayerOffset,
} from "../components/presence-layer";
export { IDENTITY_OFFSET, InTestLayer } from "../components/test-utils";
