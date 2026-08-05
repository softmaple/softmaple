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
import { type PersistenceDisplayState, StatusRail } from "./StatusRail";
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
      className="flex min-h-[100svh] flex-col overflow-hidden bg-[#EEF3F7] text-[#17253D]"
      data-testid="lexical-eg-walker-demo"
      data-room-id={roomId}
      data-persistence-mode={room.persistence?.mode ?? "initializing"}
      data-persistence-durability={room.persistence?.durability ?? "loading"}
      data-persistence-leader={room.persistence?.leader.status ?? "stopped"}
      data-storage-bytes={room.persistence?.storageBytes ?? 0}
    >
      <StatusRail
        roomId={roomId}
        connectionState={presence.connectionState}
        persistenceState={persistenceState}
        pendingCount={room.persistence?.pendingBatchIds.length ?? 0}
        storageBytes={room.persistence?.storageBytes ?? 0}
        users={presence.users}
        onCopyRoomLink={copyRoomLink}
      />

      <header className="flex items-start justify-between gap-4 px-4 pb-3 pt-4 md:px-8 md:pb-4 md:pt-6">
        <div className="min-w-0">
          <div className="mb-1.5 flex items-center gap-2 font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-[#475BD8]">
            <GitFork className="size-3.5" />
            Causal canvas · local first
          </div>
          <h1 className="font-serif text-2xl leading-tight tracking-[-0.025em] md:text-3xl">
            EG-walker × Lexical
          </h1>
          <p className="mt-1 max-w-xl text-xs leading-relaxed text-[#67758B] md:text-sm">
            One document, any number of tabs. Changes converge through stable
            sequence anchors and remain on this device after every tab closes.
          </p>
        </div>
        <a
          href="/"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-[#CBD6E2] bg-white px-2.5 py-2 text-xs font-semibold text-[#526078] shadow-sm outline-none transition-colors hover:border-[#9BAAC0] hover:text-[#17253D] focus-visible:ring-2 focus-visible:ring-[#475BD8]"
        >
          <ArrowLeft className="size-3.5" />
          <span className="hidden sm:inline">Playground</span>
        </a>
      </header>

      <section className="relative mx-auto flex w-full max-w-[1120px] flex-1 px-3 pb-3 md:px-8 md:pb-8">
        <div className="pointer-events-none absolute inset-x-10 bottom-2 top-4 rounded-[28px] bg-[#475BD8]/8 blur-2xl" />
        <div className="relative flex min-h-[540px] w-full flex-col overflow-hidden rounded-xl border border-[#CBD6E2] bg-white shadow-[0_18px_55px_rgba(23,37,61,0.12)] md:rounded-2xl">
          <div className="flex items-center justify-between border-b border-[#E1E7EF] bg-[#FAFCFE] px-4 py-2 text-[10px] font-medium uppercase tracking-[0.14em] text-[#7A879A]">
            <span>Collaborative manuscript</span>
            <span className="inline-flex items-center gap-1.5 text-[#168D91]">
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
                <div className="mx-auto mb-4 flex size-10 items-center justify-center rounded-full border border-[#BCC8D8] bg-[#EEF3F7]">
                  <span className="size-2 rounded-full bg-[#475BD8] motion-safe:animate-pulse" />
                </div>
                <p className="font-serif text-lg">
                  Replaying the room history…
                </p>
                <p className="mt-1 text-xs text-[#7A879A]">
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
              className="border-t border-[#F1C4CB] bg-[#FFF6F7] px-4 py-2 text-xs text-[#A13B4C]"
            >
              {visibleError.message}
            </div>
          ) : null}
        </div>
      </section>
    </main>
  );
}
