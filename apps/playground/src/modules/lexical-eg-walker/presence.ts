import {
  type AdapterConnectionState,
  createBroadcastChannelAdapter,
  type DirectionalSelectionRange,
  type PresenceAdapter,
  type PresenceUser,
} from "@softmaple/awareness";
import { useCallback, useEffect, useMemo, useState } from "react";

const PRESENCE_COLORS = [
  "#475BD8",
  "#E45D6F",
  "#168D91",
  "#9A5AC4",
  "#C27624",
] as const;

export interface RoomIdentity {
  readonly userId: string;
  readonly name: string;
  readonly color: string;
}

export interface RoomPresence {
  readonly adapter: PresenceAdapter;
  readonly connectionState: AdapterConnectionState;
  readonly identity: RoomIdentity;
  readonly users: ReadonlyArray<PresenceUser>;
  readonly updateSelection: (
    selection: DirectionalSelectionRange | null,
  ) => void;
}

interface AdapterValue<T> {
  readonly adapter: PresenceAdapter;
  readonly value: T;
}

const randomId = (): string => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
};

const hashString = (value: string): number => {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

export const createRoomIdentity = (id = randomId()): RoomIdentity => {
  const suffix = id.replaceAll("-", "").slice(-4).toUpperCase();
  const color = PRESENCE_COLORS[hashString(id) % PRESENCE_COLORS.length];
  if (color === undefined) {
    throw new Error("Presence palette must not be empty");
  }
  return {
    userId: id,
    name: `Peer ${suffix}`,
    color,
  };
};

export const createRoomPresenceAdapter = (
  roomId: string,
  identity: RoomIdentity,
): PresenceAdapter =>
  createBroadcastChannelAdapter({
    roomId: `lexical-eg-walker:${roomId}`,
    userInfo: identity,
    heartbeatIntervalMs: 2_000,
    offlineTimeoutMs: 7_000,
    idleTimeoutMs: 30_000,
  });

export const useRoomPresence = (roomId: string): RoomPresence => {
  const [identity] = useState(createRoomIdentity);
  const adapter = useMemo(
    () => createRoomPresenceAdapter(roomId, identity),
    [identity, roomId],
  );
  const [connectionStateState, setConnectionStateState] =
    useState<AdapterValue<AdapterConnectionState> | null>(null);
  const [usersState, setUsersState] = useState<AdapterValue<
    ReadonlyArray<PresenceUser>
  > | null>(null);
  const connectionState =
    connectionStateState?.adapter === adapter
      ? connectionStateState.value
      : "disconnected";
  const users = usersState?.adapter === adapter ? usersState.value : [];

  useEffect(() => {
    let cancelled = false;
    const unsubscribeConnection = adapter.onConnectionChange((value) => {
      if (cancelled) return;
      setConnectionStateState({ adapter, value });
    });
    const unsubscribePresence = adapter.onPresenceChange((presence) => {
      if (cancelled) return;
      setUsersState({ adapter, value: Array.from(presence.values()) });
    });
    const unsubscribeError = adapter.onError(() => {
      if (cancelled) return;
      setConnectionStateState({ adapter, value: "error" });
    });

    void adapter.connect().catch(() => {
      if (cancelled) return;
      setConnectionStateState({ adapter, value: "error" });
    });

    return () => {
      cancelled = true;
      unsubscribeError();
      unsubscribePresence();
      unsubscribeConnection();
      void adapter.disconnect();
    };
  }, [adapter]);

  const updateSelection = useCallback(
    (selection: DirectionalSelectionRange | null) => {
      adapter.updatePresence({ selection: selection ?? undefined });
    },
    [adapter],
  );

  return {
    adapter,
    connectionState,
    identity,
    users,
    updateSelection,
  };
};
