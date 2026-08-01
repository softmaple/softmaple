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
  const [connectionState, setConnectionState] =
    useState<AdapterConnectionState>("disconnected");
  const [users, setUsers] = useState<ReadonlyArray<PresenceUser>>([]);

  useEffect(() => {
    const unsubscribeConnection =
      adapter.onConnectionChange(setConnectionState);
    const unsubscribePresence = adapter.onPresenceChange((presence) => {
      setUsers(Array.from(presence.values()));
    });
    const unsubscribeError = adapter.onError(() => {
      setConnectionState("error");
    });

    void adapter.connect().catch(() => {
      setConnectionState("error");
    });

    return () => {
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
