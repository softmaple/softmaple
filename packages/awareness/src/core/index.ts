/**
 * Core presence engine — transport-agnostic status, store, and protocol.
 */

export {
  createPresenceStore,
  createSelfSession,
  type PresenceStore,
  type PresenceStoreListener,
  type PresenceStoreOptions,
} from "./presence-store";
export {
  PRESENCE_CAPABILITIES,
  PRESENCE_PROTOCOL_VERSION,
  type PresenceCapability,
  type PresenceHello,
} from "./protocol";
export {
  derivePresenceStatus,
  isUserIdle,
  isUserOffline,
  type StatusTimeouts,
  sweepPresenceStatuses,
  withDerivedStatus,
} from "./status";
