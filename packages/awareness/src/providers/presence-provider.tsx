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
import { PRESENCE_EVENT } from "../constants/presence-events";
import type { ActivityEvent, PresenceEvent } from "../types/events";
import type { PresenceUser } from "../types/presence";
import { PresenceContext, type PresenceContextValue } from "./presence-context";

/** Maximum number of recent activity events to track */
const MAX_ACTIVITY_EVENTS = 50;

/**
 * Props for PresenceProvider
 */
export interface PresenceProviderProps {
  /** The presence adapter to use */
  readonly adapter: PresenceAdapter;
  /** Whether to auto-connect on mount (default: true) */
  readonly autoConnect?: boolean;
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
 * PresenceProvider component - manages adapter lifecycle and provides context
 */
export const PresenceProvider = ({
  adapter,
  autoConnect = true,
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

  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const unsubscribeConnection = adapter.onConnectionChange((state) => {
      if (mountedRef.current) {
        setConnectionState(state);
        if (state === "connected") {
          setSelf(adapter.getSelf());
        } else if (state === "disconnected") {
          // Clear both self and presence atomically on disconnect
          setSelf(null);
          setPresence(new Map());
        }
      }
    });

    const unsubscribePresence = adapter.onPresenceChange((newPresence) => {
      if (mountedRef.current) {
        setPresence(new Map(newPresence));
        setSelf(adapter.getSelf());
      }
    });

    const unsubscribeEvent = adapter.onEvent((event) => {
      if (mountedRef.current) {
        const activity = presenceEventToActivity(event);
        if (activity) {
          setRecentActivity((prev) => addActivityEvent(prev, activity));
        }
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
