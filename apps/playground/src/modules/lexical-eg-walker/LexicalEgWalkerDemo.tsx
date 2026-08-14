import type {
  LexicalBinding,
  StableBlockSelection,
} from "@softmaple/binding-lexical";
import { LEXICAL_PLAYGROUND_CONFIG } from "@softmaple/editor/config/lexical";
import type { LexicalEditor } from "lexical";
import {
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { LexicalDocumentCanvas } from "./LexicalDocumentCanvas";
import { LexicalDocumentHeader } from "./LexicalDocumentHeader";
import { LexicalPresenceRail } from "./LexicalPresenceRail";
import { LexicalWorkspaceChrome } from "./LexicalWorkspaceChrome";
import { useRoomPresence } from "./presence";
import { createRoomId, resolveRoomId } from "./room";
import {
  mergeConnectionStates,
  type PersistenceDisplayState,
} from "./StatusRail";
import { toPresenceSelection, useLexicalRoom } from "./useLexicalRoom";

export interface LexicalEgWalkerDemoProps {
  readonly requestedRoom?: string;
}

interface RoomSessionValue<T> {
  readonly sessionKey: string;
  readonly value: T;
}

export function LexicalEgWalkerDemo({
  requestedRoom,
}: LexicalEgWalkerDemoProps) {
  const [generatedRoomId] = useState(createRoomId);
  const roomId = resolveRoomId(requestedRoom, generatedRoomId);
  const presence = useRoomPresence(roomId);
  const room = useLexicalRoom(roomId, presence.identity.userId);
  const sessionKey = JSON.stringify([roomId, presence.identity.userId]);
  const [activeEditorState, setActiveEditorState] = useState<RoomSessionValue<
    LexicalEditor | undefined
  > | null>(null);
  const [bindingState, setBindingState] =
    useState<RoomSessionValue<LexicalBinding | null> | null>(null);
  const [bindingErrorState, setBindingErrorState] =
    useState<RoomSessionValue<Error> | null>(null);
  const activeEditor =
    activeEditorState?.sessionKey === sessionKey
      ? activeEditorState.value
      : undefined;
  const binding =
    bindingState?.sessionKey === sessionKey ? bindingState.value : null;
  const bindingError =
    bindingErrorState?.sessionKey === sessionKey
      ? bindingErrorState.value
      : null;
  const editorHostRef = useRef<HTMLDivElement>(null);
  const lexicalConfig = useMemo(
    () => ({
      ...LEXICAL_PLAYGROUND_CONFIG,
      namespace: `LexicalEgWalker:${roomId}:${presence.identity.userId}`,
      editable: false,
    }),
    [presence.identity.userId, roomId],
  );

  useEffect(() => {
    if (requestedRoom !== undefined) return;
    const url = new URL(window.location.href);
    url.searchParams.set("room", roomId);
    window.history.replaceState(null, "", url);
  }, [requestedRoom, roomId]);

  const copyRoomLink = useCallback(async () => {
    const url = new URL(window.location.href);
    url.searchParams.set("room", roomId);
    await navigator.clipboard.writeText(url.toString());
  }, [roomId]);
  const updatePresenceSelection = useCallback(
    (selection: StableBlockSelection | null) => {
      presence.updateSelection(toPresenceSelection(selection));
    },
    [presence.updateSelection],
  );
  const setActiveEditor = useCallback(
    (update: SetStateAction<LexicalEditor | undefined>) => {
      setActiveEditorState((current) => {
        const previous =
          current?.sessionKey === sessionKey ? current.value : undefined;
        const value = typeof update === "function" ? update(previous) : update;
        return { sessionKey, value };
      });
    },
    [sessionKey],
  );
  const updateBinding = useCallback(
    (nextBinding: LexicalBinding | null) => {
      setBindingState((current) => {
        if (nextBinding === null && current?.sessionKey !== sessionKey) {
          return current;
        }
        return { sessionKey, value: nextBinding };
      });
      if (nextBinding !== null) {
        setBindingErrorState((current) =>
          current?.sessionKey === sessionKey ? null : current,
        );
      }
      room.onBindingChange(nextBinding);
    },
    [room.onBindingChange, sessionKey],
  );
  const reportBindingError = useCallback(
    (value: Error) => setBindingErrorState({ sessionKey, value }),
    [sessionKey],
  );
  const persistenceState: PersistenceDisplayState =
    room.persistence?.durability ?? "loading";
  const visibleError = bindingError ?? room.error;

  return (
    <main
      className="flex min-h-[100svh] flex-col overflow-x-hidden bg-[var(--pg-paper)] text-[var(--pg-ink)]"
      data-testid="lexical-eg-walker-demo"
      data-room-id={roomId}
      data-transport={presence.transportMode}
      data-persistence-mode={room.persistence?.mode ?? "initializing"}
      data-persistence-durability={room.persistence?.durability ?? "loading"}
      data-persistence-leader={room.persistence?.leader.status ?? "stopped"}
      data-storage-bytes={room.persistence?.storageBytes ?? 0}
    >
      <LexicalWorkspaceChrome
        roomId={roomId}
        identity={presence.identity}
        connectionState={mergeConnectionStates(
          presence.connectionState,
          room.persistence?.syncConnectionState,
        )}
        transportMode={presence.transportMode}
        persistenceState={persistenceState}
        pendingCount={room.persistence?.pendingBatchIds.length ?? 0}
        storageBytes={room.persistence?.storageBytes ?? 0}
        users={presence.users}
        onCopyRoomLink={copyRoomLink}
      />

      <div className="flex min-h-0 flex-1">
        <LexicalPresenceRail
          selfId={presence.identity.userId}
          users={presence.users}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <LexicalDocumentHeader transportMode={presence.transportMode} />
          <LexicalDocumentCanvas
            activeEditor={activeEditor}
            binding={binding}
            editorHostRef={editorHostRef}
            lexicalConfig={lexicalConfig}
            onBindingChange={updateBinding}
            onBindingError={reportBindingError}
            onSelectionChange={updatePresenceSelection}
            presence={presence}
            replica={room.replica}
            sessionKey={sessionKey}
            setActiveEditor={setActiveEditor}
            visibleError={visibleError}
          />
        </div>
      </div>
    </main>
  );
}
