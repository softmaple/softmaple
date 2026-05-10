/**
 * Presence Provider - Manages adapter lifecycle and provides presence state
 * Based on docs/design/awareness-and-presence.md
 */

import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  AdapterConnectionState,
  PresenceAdapter,
} from "../adapters/types";
import { ACTIVITY_TYPE, PRESENCE_EVENT } from "../constants/presence-events";
import { determineUserStatus } from "../state/status-operations";
import type { ActivityEvent, PresenceEvent } from "../types/events";
import type { PresenceUser } from "../types/presence";
import {
  DEFAULT_PRESENCE_CONFIG,
  type PresenceStateConfig,
} from "../types/state";
import { PresenceContext, type PresenceContextValue } from "./presence-context";

/** Maximum number of recent activity events to track */
const MAX_ACTIVITY_EVENTS = 50;

/** Default interval (ms) between idle/offline status sweeps */
const DEFAULT_STATUS_SWEEP_MS = 5_000;

/**
 * Props for PresenceProvider
 */
export interface PresenceProviderProps {
  /** The presence adapter to use */
  readonly adapter: PresenceAdapter;
  /** Whether to auto-connect on mount (default: true) */
  readonly autoConnect?: boolean;
  /**
   * Idle/offline thresholds used by the local status sweep. Defaults to
   * `DEFAULT_PRESENCE_CONFIG`.
   */
  readonly statusConfig?: PresenceStateConfig;
  /**
   * Interval (ms) between local status sweeps that demote stale users to
   * `idle`/`offline`. Pass `0` to disable sweeping entirely (e.g. if the
   * adapter already authoritatively manages status). Defaults to 5000.
   */
  readonly statusSweepMs?: number;
  /** Children to render */
  readonly children: ReactNode;
}

/**
 * Derive others list from presence map (excluding self)
 */
const deriveOthers = (
  presence: ReadonlyMap<string, PresenceUser>,
  selfId: string | null,
): ReadonlyArray<PresenceUser> => {
  if (selfId === null) return [];
  const others: PresenceUser[] = [];
  for (const [userId, user] of presence) {
    if (userId !== selfId) {
      others.push(user);
    }
  }
  return others;
};

/**
 * Convert presence event to activity event (pure function)
 */
const presenceEventToActivity = (
  event: PresenceEvent,
): ActivityEvent | null => {
  const { type, payload, timestamp } = event;
  switch (type) {
    case PRESENCE_EVENT.JOIN:
      if (payload.type === PRESENCE_EVENT.JOIN) {
        return {
          userId: payload.user.userId,
          timestamp,
          type: "join",
          data: { type: "join", user: payload.user },
        };
      }
      return null;
    case PRESENCE_EVENT.LEAVE:
      if (payload.type === PRESENCE_EVENT.LEAVE) {
        return {
          userId: payload.userId,
          timestamp,
          type: "leave",
          data: { type: "leave", userId: payload.userId },
        };
      }
      return null;
    case PRESENCE_EVENT.UPDATE:
      if (payload.type === PRESENCE_EVENT.UPDATE) {
        if (payload.updates.cursor !== undefined) {
          return {
            userId: payload.userId,
            timestamp,
            type: ACTIVITY_TYPE.CURSOR,
            data: {
              type: ACTIVITY_TYPE.CURSOR,
              position: payload.updates.cursor ?? null,
            },
          };
        }
        if (payload.updates.selection !== undefined) {
          return {
            userId: payload.userId,
            timestamp,
            type: ACTIVITY_TYPE.SELECTION,
            data: {
              type: ACTIVITY_TYPE.SELECTION,
              range: payload.updates.selection ?? null,
            },
          };
        }
        if (payload.updates.meta?.isTyping !== undefined) {
          if (!payload.updates.meta.isTyping) {
            return null;
          }

          return {
            userId: payload.userId,
            timestamp,
            type: ACTIVITY_TYPE.TYPING,
            data: {
              type: ACTIVITY_TYPE.TYPING,
              isTyping: payload.updates.meta.isTyping,
            },
          };
        }
      }
      return null;
    default:
      return null;
  }
};

/**
 * Add activity event to list (immutable, bounded)
 */
const addActivityEvent = (
  events: ReadonlyArray<ActivityEvent>,
  newEvent: ActivityEvent,
): ReadonlyArray<ActivityEvent> => {
  const updated = [newEvent, ...events];
  return updated.length > MAX_ACTIVITY_EVENTS
    ? updated.slice(0, MAX_ACTIVITY_EVENTS)
    : updated;
};

/**
 * Apply local status demotion (active → idle → offline) based on lastActiveAt.
 * Returns the same map reference if no user's status changed (lets memoization
 * short-circuit downstream).
 */
const applyStatusSweep = (
  presence: ReadonlyMap<string, PresenceUser>,
  config: PresenceStateConfig,
): ReadonlyMap<string, PresenceUser> => {
  let next: Map<string, PresenceUser> | null = null;
  for (const [userId, user] of presence) {
    const newStatus = determineUserStatus(user, config);
    if (newStatus !== user.status) {
      if (next === null) next = new Map(presence);
      next.set(userId, { ...user, status: newStatus });
    }
  }
  return next ?? presence;
};

/**
 * PresenceProvider component - manages adapter lifecycle and provides context
 */
export const PresenceProvider = ({
  adapter,
  autoConnect = true,
  statusConfig = DEFAULT_PRESENCE_CONFIG,
  statusSweepMs = DEFAULT_STATUS_SWEEP_MS,
  children,
}: PresenceProviderProps): ReactNode => {
  // Use lazy initializers to get real adapter state on first render
  const [connectionState, setConnectionState] =
    useState<AdapterConnectionState>(() => adapter.getConnectionState());
  const [self, setSelf] = useState<PresenceUser | null>(() =>
    adapter.getSelf(),
  );
  const [presence, setPresence] = useState<ReadonlyMap<string, PresenceUser>>(
    () => new Map(adapter.getPresence()),
  );
  const [recentActivity, setRecentActivity] = useState<
    ReadonlyArray<ActivityEvent>
  >([]);

  useEffect(() => {
    const unsubscribeConnection = adapter.onConnectionChange((state) => {
      setConnectionState(state);
      if (state === "connected") {
        setSelf(adapter.getSelf());
      } else if (state === "disconnected") {
        // Clear both self and presence atomically on disconnect
        setSelf(null);
        setPresence(new Map());
      }
    });

    const unsubscribePresence = adapter.onPresenceChange((newPresence) => {
      setPresence(new Map(newPresence));
      setSelf(adapter.getSelf());
    });

    const unsubscribeEvent = adapter.onEvent((event) => {
      const activity = presenceEventToActivity(event);
      if (activity) {
        setRecentActivity((prev) => addActivityEvent(prev, activity));
      }
    });

    return () => {
      unsubscribeConnection();
      unsubscribePresence();
      unsubscribeEvent();
    };
  }, [adapter]);

  useEffect(() => {
    if (autoConnect) {
      adapter.connect().catch((error) => {
        console.error("Failed to connect presence adapter:", error);
      });
    }

    return () => {
      adapter.disconnect().catch((error) => {
        console.error("Failed to disconnect presence adapter:", error);
      });
    };
  }, [adapter, autoConnect]);

  // Local status sweep — demotes stale users to `idle`/`offline` so the
  // displayed status reflects time since `lastActiveAt` even if the adapter
  // hasn't pushed a status update. Stays a no-op if every user's status
  // already matches the threshold-derived value.
  const presenceRef = useRef(presence);
  // Sync the ref in an effect (not during render) so concurrent-mode
  // discarded renders cannot leave the ref pointing at unmounted state.
  useEffect(() => {
    presenceRef.current = presence;
  }, [presence]);

  // Destructure to primitive deps so a consumer passing an inline
  // `statusConfig` literal does not tear down/recreate the interval on
  // every render.
  const { idleTimeoutMs, offlineTimeoutMs } = statusConfig;

  useEffect(() => {
    if (statusSweepMs <= 0) return;

    const sweepConfig: PresenceStateConfig = {
      ...DEFAULT_PRESENCE_CONFIG,
      idleTimeoutMs,
      offlineTimeoutMs,
    };

    const tick = () => {
      const current = presenceRef.current;
      const swept = applyStatusSweep(current, sweepConfig);
      if (swept !== current) {
        setPresence(swept);
        const selfId = adapter.getSelf()?.userId;
        if (selfId !== undefined) {
          const updated = swept.get(selfId);
          if (updated !== undefined) setSelf(updated);
        }
      }
    };

    const id = setInterval(tick, statusSweepMs);
    return () => clearInterval(id);
  }, [adapter, idleTimeoutMs, offlineTimeoutMs, statusSweepMs]);

  // Use adapter directly in callbacks (no ref needed)
  const connect = useCallback(async (): Promise<void> => {
    await adapter.connect();
  }, [adapter]);

  const disconnect = useCallback(async (): Promise<void> => {
    await adapter.disconnect();
  }, [adapter]);

  const updatePresence = useCallback(
    (updates: Partial<Omit<PresenceUser, "userId">>): void => {
      adapter.updatePresence(updates);
    },
    [adapter],
  );

  const others = useMemo(
    () => deriveOthers(presence, self?.userId ?? null),
    [presence, self?.userId],
  );

  const contextValue: PresenceContextValue = useMemo(
    () => ({
      connectionState,
      self,
      presence,
      others,
      recentActivity,
      updatePresence,
      connect,
      disconnect,
      adapter,
    }),
    [
      connectionState,
      self,
      presence,
      others,
      recentActivity,
      updatePresence,
      connect,
      disconnect,
      adapter,
    ],
  );

  return (
    <PresenceContext.Provider value={contextValue}>
      {children}
    </PresenceContext.Provider>
  );
};
