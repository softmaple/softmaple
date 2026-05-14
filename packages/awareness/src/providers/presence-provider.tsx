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
import { DEFAULT_PRESENCE_CONFIG } from "../state/selectors";
import { determineUserStatus } from "../state/status-operations";
import {
  ACTIVITY_TYPE,
  type ActivityEvent,
  PRESENCE_EVENT,
  type PresenceEvent,
} from "../types/events";
import type { PresenceUser } from "../types/presence";
import type { PresenceStateConfig } from "../types/state";
import { PresenceContext, type PresenceContextValue } from "./presence-context";

/** Default cap on the bounded recent-activity buffer */
const DEFAULT_MAX_RECENT_ACTIVITY = 50;

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
  /**
   * Maximum number of recent activity events to retain. Older events are
   * dropped FIFO. Defaults to 50.
   */
  readonly maxRecentActivity?: number;
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
 * Add activity event to list (immutable, bounded).
 *
 * Caller passes the cap so it can be tuned per-provider via the
 * `maxRecentActivity` prop.
 */
const addActivityEvent = (
  events: ReadonlyArray<ActivityEvent>,
  newEvent: ActivityEvent,
  maxEvents: number,
): ReadonlyArray<ActivityEvent> => {
  const updated = [newEvent, ...events];
  return updated.length > maxEvents ? updated.slice(0, maxEvents) : updated;
};

/**
 * Append multiple new events at once. Preserves "newest first" ordering and
 * applies the cap a single time.
 */
const addActivityEvents = (
  events: ReadonlyArray<ActivityEvent>,
  newEvents: ReadonlyArray<ActivityEvent>,
  maxEvents: number,
): ReadonlyArray<ActivityEvent> => {
  if (newEvents.length === 0) return events;
  const updated = [...newEvents, ...events];
  return updated.length > maxEvents ? updated.slice(0, maxEvents) : updated;
};

/**
 * Result of a single status sweep: the (possibly new) presence map and the
 * list of users whose status transitioned this tick. Activities are emitted
 * for transitions to `idle` and `offline` so consumers can render "X went
 * idle" / "X went offline" notifications.
 */
interface StatusSweepResult {
  readonly presence: ReadonlyMap<string, PresenceUser>;
  readonly transitions: ReadonlyArray<PresenceUser>;
}

/**
 * Apply local status demotion (active → idle → offline) based on
 * `lastActiveAt`. Returns the same map reference when no user transitioned
 * so React can short-circuit downstream memoization.
 */
const applyStatusSweep = (
  presence: ReadonlyMap<string, PresenceUser>,
  config: PresenceStateConfig,
): StatusSweepResult => {
  let next: Map<string, PresenceUser> | null = null;
  const transitions: PresenceUser[] = [];
  for (const [userId, user] of presence) {
    const newStatus = determineUserStatus(user, config);
    if (newStatus !== user.status) {
      if (next === null) next = new Map(presence);
      const updated = { ...user, status: newStatus };
      next.set(userId, updated);
      transitions.push(updated);
    }
  }
  return { presence: next ?? presence, transitions };
};

/**
 * Build the activity events emitted by a status sweep transition. Only
 * idle demotions produce activity — promotions back to `active` are implicit
 * in cursor/typing/selection updates, and `offline` already has no
 * dedicated activity type (consumers can derive it from `presence`).
 */
const sweepTransitionsToActivities = (
  transitions: ReadonlyArray<PresenceUser>,
): ReadonlyArray<ActivityEvent> => {
  const events: ActivityEvent[] = [];
  for (const user of transitions) {
    if (user.status === "idle") {
      events.push({
        userId: user.userId,
        timestamp: Date.now(),
        type: ACTIVITY_TYPE.IDLE,
        data: { type: ACTIVITY_TYPE.IDLE },
      });
    }
  }
  return events;
};

/**
 * PresenceProvider component - manages adapter lifecycle and provides context
 */
export const PresenceProvider = ({
  adapter,
  autoConnect = true,
  statusConfig = DEFAULT_PRESENCE_CONFIG,
  statusSweepMs = DEFAULT_STATUS_SWEEP_MS,
  maxRecentActivity = DEFAULT_MAX_RECENT_ACTIVITY,
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
        setRecentActivity((prev) =>
          addActivityEvent(prev, activity, maxRecentActivity),
        );
      }
    });

    return () => {
      unsubscribeConnection();
      unsubscribePresence();
      unsubscribeEvent();
    };
  }, [adapter, maxRecentActivity]);

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
      const { presence: swept, transitions } = applyStatusSweep(
        current,
        sweepConfig,
      );
      if (swept !== current) {
        // Keep the ref in lockstep with the sweep result so subsequent ticks
        // see the post-sweep statuses immediately, before React commits the
        // `setPresence` state update. Otherwise two ticks back-to-back can
        // re-emit the same idle transition.
        presenceRef.current = swept;
        setPresence(swept);
        const selfId = adapter.getSelf()?.userId;
        if (selfId !== undefined) {
          const updated = swept.get(selfId);
          if (updated !== undefined) setSelf(updated);
        }
        const newActivities = sweepTransitionsToActivities(transitions);
        if (newActivities.length > 0) {
          setRecentActivity((prev) =>
            addActivityEvents(prev, newActivities, maxRecentActivity),
          );
        }
      }
    };

    const id = setInterval(tick, statusSweepMs);
    return () => clearInterval(id);
  }, [
    adapter,
    idleTimeoutMs,
    offlineTimeoutMs,
    statusSweepMs,
    maxRecentActivity,
  ]);

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
