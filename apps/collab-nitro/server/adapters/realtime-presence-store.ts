import type { PresenceStore } from "@softmaple/collab-runtime";
import { getRealtime } from "../utils/realtime";

/** Redis/memory presence membership behind the runtime store port. */
export const realtimePresenceStore: PresenceStore = {
  async getMember(roomId, connectionId) {
    return getRealtime().presence.getUser(roomId, connectionId);
  },

  async listMembers(roomId) {
    const { users, expired } = await getRealtime().presence.listUsers(roomId);
    return { expired, members: users };
  },

  async refreshMember(roomId, connectionId, ttlMs) {
    return getRealtime().presence.refresh(roomId, connectionId, ttlMs);
  },

  async removeMember(roomId, connectionId) {
    return getRealtime().presence.removeUser(roomId, connectionId);
  },

  async setMember(roomId, member, ttlMs) {
    await getRealtime().presence.setUser(roomId, member, ttlMs);
  },
};
