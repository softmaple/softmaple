/**
 * Wires a BroadcastChannel-backed presence adapter for the awareness
 * playground demo. Returns the adapter and the resolved `AdapterUserInfo`
 * so the parent can both pass it to `<PresenceProvider>` and reference
 * the chosen trainer.
 *
 * Lifecycle: this hook deliberately has no cleanup. `<PresenceProvider>`
 * owns the adapter's connect/disconnect — it calls `adapter.disconnect()`
 * on unmount and whenever its `adapter` prop changes, which closes the
 * underlying BroadcastChannel (see
 * packages/awareness/src/adapters/broadcast-channel/broadcast-channel.ts).
 * Because the `useMemo` keys on `[trainerId, roomId]`, a trainer/room
 * switch produces a new adapter instance; the provider observes the prop
 * change and disposes the old one. Adding a cleanup here would just
 * double-dispose.
 */

import {
  type AdapterUserInfo,
  createBroadcastChannelAdapter,
  type PresenceAdapter,
} from "@softmaple/awareness";
import { useMemo } from "react";
import { getTrainer } from "./trainers";

export interface UseAwarenessAdapterResult {
  readonly adapter: PresenceAdapter;
  readonly userInfo: AdapterUserInfo;
}

export const useAwarenessAdapter = (
  trainerId: string,
  roomId: string,
): UseAwarenessAdapterResult => {
  return useMemo(() => {
    const trainer = getTrainer(trainerId);
    if (!trainer) {
      throw new Error(`Unknown trainer id: ${trainerId}`);
    }

    // Suffix the userId with a short unique tag so multiple tabs choosing
    // the same trainer don't collide. Awareness still groups them as
    // distinct presences.
    const tabTag = crypto.randomUUID().slice(0, 6);
    const userInfo: AdapterUserInfo = {
      userId: `${trainer.id}-${tabTag}`,
      name: trainer.name,
      color: trainer.color,
      avatarUrl: trainer.avatarUrl,
    };

    const adapter = createBroadcastChannelAdapter({
      roomId,
      userInfo,
    });

    return { adapter, userInfo };
  }, [trainerId, roomId]);
};
