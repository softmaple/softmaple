export {
  ActivityIndicator,
  type ActivityIndicatorProps,
} from "./activity-indicator";
export {
  BlockActivityIndicator,
  type BlockActivityIndicatorProps,
} from "./block-activity-indicator";
export {
  ConnectionIndicator,
  type ConnectionIndicatorLabels,
  type ConnectionIndicatorProps,
} from "./connection-indicator";
export {
  LiveCursor,
  type LiveCursorPoint,
  type LiveCursorProps,
  type LiveCursorViewport,
} from "./live-cursor";
export {
  PresenceAvatar,
  type PresenceAvatarProps,
  type PresenceAvatarSize,
} from "./presence-avatar";
export { PresenceBar, type PresenceBarProps } from "./presence-bar";
export {
  PresenceLayer,
  type PresenceLayerOffset,
  type PresenceLayerProps,
  usePresenceLayerOffset,
} from "./presence-layer";
// `PresenceLayerContext` is intentionally not re-exported here. It's a
// testing backdoor (lets tests inject a fixed offset without going
// through layout-effect measurement) and exposing it on the public
// entry invites consumers to bypass measurement in production. Use
// `@softmaple/awareness/testing` in test code.
export {
  type HighlightRect,
  SelectionHighlight,
  type SelectionHighlightProps,
} from "./selection-highlight";
