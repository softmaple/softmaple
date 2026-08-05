import type {
  AdapterConnectionState,
  DirectionalSelectionRange,
  PresenceAdapter,
  PresenceUser,
} from "@softmaple/awareness";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type LexicalCollabTransportMode,
  resolveLexicalRoomTransport,
} from "./transport";

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
  readonly adapter: PresenceAdapter | null;
  readonly connectionState: AdapterConnectionState;
  readonly identity: RoomIdentity;
  readonly users: ReadonlyArray<PresenceUser>;
  readonly transportMode: LexicalCollabTransportMode;
  readonly updateSelection: (
    selection: DirectionalSelectionRange | null,
  ) => void;
}

const randomId = (): string => crypto.randomUUID();

const hashString = (value: string): number => {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
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
  resolveLexicalRoomTransport(roomId).createPresenceAdapter(identity);

export const useRoomPresence = (roomId: string): RoomPresence => {
  const [identity] = useState(createRoomIdentity);
  const transport = useMemo(
    () => resolveLexicalRoomTransport(roomId),
    [roomId],
  );
  const sessionKey = roomId;
  const [adapterState, setAdapterState] = useState<{
    readonly sessionKey: string;
    readonly adapter: PresenceAdapter;
  } | null>(null);
  const [connectionStateState, setConnectionStateState] = useState<{
    readonly sessionKey: string;
    readonly value: AdapterConnectionState;
  } | null>(null);
  const [usersState, setUsersState] = useState<{
    readonly sessionKey: string;
    readonly value: ReadonlyArray<PresenceUser>;
  } | null>(null);
  const adapterRef = useRef<PresenceAdapter | null>(null);

  const adapter =
    adapterState?.sessionKey === sessionKey ? adapterState.adapter : null;
  const connectionState =
    connectionStateState?.sessionKey === sessionKey
      ? connectionStateState.value
      : "disconnected";
  const users = usersState?.sessionKey === sessionKey ? usersState.value : [];

  useEffect(() => {
    let cancelled = false;
    // Fresh adapter per effect instance avoids connect/disconnect races when
    // React Strict Mode remounts and would otherwise close a shared socket.
    const nextAdapter = transport.createPresenceAdapter(identity);
    adapterRef.current = nextAdapter;

    const unsubscribeConnection = nextAdapter.onConnectionChange((value) => {
      if (cancelled) return;
      setConnectionStateState({ sessionKey, value });
    });
    const unsubscribePresence = nextAdapter.onPresenceChange((presence) => {
      if (cancelled) return;
      setUsersState({
        sessionKey,
        value: Array.from(presence.values()),
      });
    });
    const unsubscribeError = nextAdapter.onError(() => {
      if (cancelled) return;
      setConnectionStateState({ sessionKey, value: "error" });
    });

    setAdapterState({ sessionKey, adapter: nextAdapter });
    setConnectionStateState({
      sessionKey,
      value: nextAdapter.getConnectionState(),
    });
    setUsersState({
      sessionKey,
      value: Array.from(nextAdapter.getPresence().values()),
    });

    void nextAdapter.connect().catch(() => {
      if (cancelled) return;
      setConnectionStateState({ sessionKey, value: "error" });
    });

    return () => {
      cancelled = true;
      unsubscribeError();
      unsubscribePresence();
      unsubscribeConnection();
      if (adapterRef.current === nextAdapter) {
        adapterRef.current = null;
      }
      void nextAdapter.disconnect();
    };
  }, [identity, sessionKey, transport]);

  const updateSelection = useCallback(
    (selection: DirectionalSelectionRange | null) => {
      adapterRef.current?.updatePresence({
        selection: selection ?? undefined,
      });
    },
    [],
  );

  return {
    adapter,
    connectionState,
    identity,
    users,
    transportMode: transport.mode,
    updateSelection,
  };
};
