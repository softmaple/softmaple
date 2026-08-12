/**
 * Protocol version and capability bits for Softmaple awareness.
 *
 * Re-exported from `../protocol/version` — the source of truth moved there
 * so `@softmaple/awareness/protocol` can be a dependency-free subpath;
 * `.` and `./adapters/websocket` keep their exact public surface.
 */
export {
  PRESENCE_CAPABILITIES,
  PRESENCE_PROTOCOL_VERSION,
  type PresenceCapability,
  type PresenceHello,
} from "../protocol/version";
