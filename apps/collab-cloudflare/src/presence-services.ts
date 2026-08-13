import {
  DEFAULT_PRESENCE_ROOM_POLICY,
  type PresenceRoomServices,
} from "@softmaple/collab-runtime";
import { awarenessPresenceCodec } from "./awareness-presence-codec";
import { logError, logMetric } from "./constants";
import {
  createDurableObjectPresenceConnectionLimiter,
  createDurableObjectPresenceFanout,
  createDurableObjectPresenceStore,
} from "./presence-capabilities";
import {
  createSupabasePresenceBackend,
  type PresenceBackend,
} from "./supabase-presence-backend";

export const createPresenceServicesForBackend = (
  storage: DurableObjectStorage,
  backend: PresenceBackend,
): PresenceRoomServices => ({
  codec: awarenessPresenceCodec,
  connections: createDurableObjectPresenceConnectionLimiter(),
  fanout: createDurableObjectPresenceFanout(),
  metrics: logMetric,
  policy: DEFAULT_PRESENCE_ROOM_POLICY,
  reportError(error, context) {
    logError(error, {
      messageType: context.messageType,
      peerId: context.peerId,
      roomId: context.roomId,
    });
  },
  sessions: backend.sessions,
  store: createDurableObjectPresenceStore(storage),
});

export const createPresenceServices = (
  env: Env,
  storage: DurableObjectStorage,
): PresenceRoomServices =>
  createPresenceServicesForBackend(storage, createSupabasePresenceBackend(env));
