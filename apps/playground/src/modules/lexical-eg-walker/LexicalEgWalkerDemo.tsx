import type {
  LexicalBinding,
  StableBlockSelection,
} from "@softmaple/binding-lexical";
import { LexicalEgWalkerPlugin } from "@softmaple/binding-lexical/react";
import { CoreEditor } from "@softmaple/editor/components/core/CoreEditor";
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
import { CollaborationLab } from "./CollaborationLab";
import { useRoomPresence } from "./presence";
import { RemoteSelectionLayer } from "./RemoteSelectionLayer";
import { createRoomId, resolveRoomId } from "./room";
import { SoloCollabHint } from "./SoloCollabHint";
import {
  mergeConnectionStates,
  type PersistenceDisplayState,
  StatusRail,
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
  const [shareOpen, setShareOpen] = useState(false);
  const [labOpen, setLabOpen] = useState(false);
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
  const documentSyncState = room.persistence?.syncConnectionState ?? null;
  const connectionState = mergeConnectionStates(
    presence.connectionState,
    documentSyncState,
  );
  const pendingCount = room.persistence?.pendingBatchIds.length ?? 0;
  const storageBytes = room.persistence?.storageBytes ?? 0;
  const durableBatchCount = room.persistence?.durableBatchIds.length ?? 0;
  const showSoloHint =
    room.replica !== null && presence.users.length <= 1 && !labOpen;

  return (
    <main
      className="flex min-h-[100svh] flex-col overflow-hidden bg-[var(--pg-paper)] text-[var(--pg-ink)]"
      data-testid="lexical-eg-walker-demo"
      data-room-id={roomId}
      data-transport={presence.transportMode}
      data-persistence-mode={room.persistence?.mode ?? "initializing"}
      data-persistence-durability={room.persistence?.durability ?? "loading"}
      data-persistence-leader={room.persistence?.leader.status ?? "stopped"}
      data-storage-bytes={storageBytes}
    >
      <StatusRail
        roomId={roomId}
        replicaId={presence.identity.userId}
        connectionState={connectionState}
        presenceState={presence.connectionState}
        documentSyncState={documentSyncState}
        transportMode={presence.transportMode}
        persistenceState={persistenceState}
        pendingCount={pendingCount}
        storageBytes={storageBytes}
        users={presence.users}
        shareOpen={shareOpen}
        onShareOpenChange={setShareOpen}
        labOpen={labOpen}
        onLabOpenChange={setLabOpen}
      />

      <section className="relative flex min-h-0 flex-1 flex-col md:flex-row">
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
          {room.replica === null ? (
            <div
              className="grid flex-1 place-items-center p-8 text-center"
              data-testid="lexical-room-loading"
            >
              <div>
                <div className="mx-auto mb-4 flex size-10 items-center justify-center border border-[var(--pg-line)] bg-[var(--pg-surface)]">
                  <span className="size-2 bg-[var(--pg-accent)] motion-safe:animate-pulse" />
                </div>
                <p className="font-[family-name:var(--font-display)] text-lg font-semibold">
                  Replaying the room history…
                </p>
                <p className="mt-1 text-xs text-[var(--pg-ink-muted)]">
                  Editing opens after the first converged document is ready.
                </p>
              </div>
            </div>
          ) : (
            <div
              ref={editorHostRef}
              className="relative min-h-0 flex-1 overflow-auto"
              data-testid="lexical-room-ready"
            >
              <CoreEditor
                key={sessionKey}
                activeEditor={activeEditor}
                setActiveEditor={setActiveEditor}
                historyMode="disabled"
                lexicalConfig={lexicalConfig}
                layoutClassName="mx-0 my-0 max-w-none min-h-full font-normal leading-[1.7] [&_.flex-auto]:w-full [&_.flex-auto]:flex-1 [&_[contenteditable=true]]:min-h-[min(70svh,640px)] [&_[contenteditable=true]]:w-full [&_[contenteditable=true]]:px-6 [&_[contenteditable=true]]:py-8 [&_[aria-hidden=true]>div]:left-6 [&_[aria-hidden=true]>div]:right-6 [&_[aria-hidden=true]>div]:top-8 md:[&_[contenteditable=true]]:px-14 md:[&_[contenteditable=true]]:py-12 md:[&_[aria-hidden=true]>div]:left-14 md:[&_[aria-hidden=true]>div]:right-14 md:[&_[aria-hidden=true]>div]:top-12"
              >
                <LexicalEgWalkerPlugin
                  replica={room.replica}
                  onBindingChange={updateBinding}
                  onError={reportBindingError}
                  onSelectionChange={updatePresenceSelection}
                />
              </CoreEditor>
              <RemoteSelectionLayer
                binding={binding}
                hostRef={editorHostRef}
                selfId={presence.identity.userId}
                users={presence.users}
              />
              {showSoloHint ? (
                <SoloCollabHint
                  roomId={roomId}
                  onShare={() => setShareOpen(true)}
                />
              ) : null}
            </div>
          )}
          {visibleError !== null ? (
            <div
              role="alert"
              className="border-t border-rose-200 bg-rose-50 px-4 py-2 text-xs text-rose-800"
            >
              {visibleError.message}
            </div>
          ) : null}
        </div>

        <CollaborationLab
          open={labOpen}
          onOpenChange={setLabOpen}
          roomId={roomId}
          replicaId={presence.identity.userId}
          connectionState={connectionState}
          transportMode={presence.transportMode}
          persistenceState={persistenceState}
          pendingCount={pendingCount}
          durableBatchCount={durableBatchCount}
          storageBytes={storageBytes}
        />
      </section>
    </main>
  );
}
