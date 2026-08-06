import type {
  LexicalBinding,
  StableBlockSelection,
} from "@softmaple/binding-lexical";
import { LexicalEgWalkerPlugin } from "@softmaple/binding-lexical/react";
import { CoreEditor } from "@softmaple/editor/components/core/CoreEditor";
import { LEXICAL_PLAYGROUND_CONFIG } from "@softmaple/editor/config/lexical";
import type { LexicalEditor } from "lexical";
import { ArrowLeft, GitFork, ShieldCheck } from "lucide-react";
import {
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRoomPresence } from "./presence";
import { RemoteSelectionLayer } from "./RemoteSelectionLayer";
import { createRoomId, resolveRoomId } from "./room";
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

  const copyRoomLink = useCallback(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("room", roomId);
    void navigator.clipboard?.writeText(url.toString()).catch(() => undefined);
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
      className="flex min-h-[100svh] flex-col overflow-hidden bg-[var(--pg-paper)] text-[var(--pg-ink)]"
      data-testid="lexical-eg-walker-demo"
      data-room-id={roomId}
      data-transport={presence.transportMode}
      data-persistence-mode={room.persistence?.mode ?? "initializing"}
      data-persistence-durability={room.persistence?.durability ?? "loading"}
      data-persistence-leader={room.persistence?.leader.status ?? "stopped"}
      data-storage-bytes={room.persistence?.storageBytes ?? 0}
    >
      <StatusRail
        roomId={roomId}
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

      <header className="flex items-start justify-between gap-4 px-4 pt-4 pb-3 md:px-8 md:pt-6 md:pb-4">
        <div className="min-w-0">
          <div className="mb-1.5 flex items-center gap-2 font-[family-name:var(--font-mono)] text-[10px] font-semibold tracking-[0.18em] text-[var(--pg-accent)] uppercase">
            <GitFork className="size-3.5" />
            Causal canvas ·{" "}
            {presence.transportMode === "websocket"
              ? "WebSocket"
              : "local first"}
          </div>
          <h1 className="font-[family-name:var(--font-display)] text-2xl leading-tight font-bold tracking-[-0.03em] md:text-3xl">
            EG-walker × Lexical
          </h1>
          <p className="mt-1 max-w-xl text-xs leading-relaxed text-[var(--pg-ink-muted)] md:text-sm">
            {presence.transportMode === "websocket"
              ? "One document across browsers. Document events and presence sync over WebSocket; a local copy remains on this device."
              : "One document, any number of tabs. Changes converge through stable sequence anchors and remain on this device after every tab closes. Add ?transport=websocket for cross-browser sync."}
          </p>
        </div>
        <a
          href="/"
          className="inline-flex shrink-0 items-center gap-1.5 border border-[var(--pg-line)] bg-[var(--pg-elevated)] px-2.5 py-2 text-xs font-semibold text-[var(--pg-ink-muted)] outline-none transition-colors hover:border-[var(--pg-ink-muted)] hover:text-[var(--pg-ink)] focus-visible:ring-2 focus-visible:ring-[var(--pg-accent)]"
        >
          <ArrowLeft className="size-3.5" />
          <span className="hidden sm:inline">Playground</span>
        </a>
      </header>

      <section className="relative mx-auto flex w-full max-w-[1120px] flex-1 px-3 pb-3 md:px-8 md:pb-8">
        <div className="pg-panel relative flex min-h-[540px] w-full flex-col overflow-hidden">
          <div className="pg-panel-header flex items-center justify-between px-4 py-2 font-[family-name:var(--font-mono)] text-[10px] font-medium tracking-[0.14em] text-[var(--pg-ink-muted)] uppercase">
            <span>Collaborative manuscript</span>
            <span className="inline-flex items-center gap-1.5 text-teal-400">
              <ShieldCheck className="size-3.5" />
              v1 schema
            </span>
          </div>
          {room.replica === null ? (
            <div
              className="grid flex-1 place-items-center p-8 text-center"
              data-testid="lexical-room-loading"
            >
              <div>
                <div className="mx-auto mb-4 flex size-10 items-center justify-center border border-[var(--pg-line)] bg-[var(--pg-paper)]">
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
              className="relative flex-1"
              data-testid="lexical-room-ready"
            >
              <CoreEditor
                key={sessionKey}
                activeEditor={activeEditor}
                setActiveEditor={setActiveEditor}
                historyMode="disabled"
                lexicalConfig={lexicalConfig}
                layoutClassName="mx-0 my-0 max-w-none min-h-full font-normal leading-[1.7] [&_.flex-auto]:w-full [&_.flex-auto]:flex-1 [&_[contenteditable=true]]:min-h-[440px] [&_[contenteditable=true]]:w-full [&_[contenteditable=true]]:px-6 [&_[contenteditable=true]]:py-8 [&_[aria-hidden=true]>div]:left-6 [&_[aria-hidden=true]>div]:right-6 [&_[aria-hidden=true]>div]:top-8 md:[&_[contenteditable=true]]:px-14 md:[&_[contenteditable=true]]:py-12 md:[&_[aria-hidden=true]>div]:left-14 md:[&_[aria-hidden=true]>div]:right-14 md:[&_[aria-hidden=true]>div]:top-12"
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
            </div>
          )}
          {visibleError !== null ? (
            <div
              role="alert"
              className="border-t border-rose-400/25 bg-rose-500/10 px-4 py-2 text-xs text-rose-300"
            >
              {visibleError.message}
            </div>
          ) : null}
        </div>
      </section>
    </main>
  );
}
