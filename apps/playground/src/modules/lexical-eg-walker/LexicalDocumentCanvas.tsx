import type { InitialConfigType } from "@lexical/react/LexicalComposer";
import type {
  LexicalBinding,
  StableBlockSelection,
} from "@softmaple/binding-lexical";
import { LexicalEgWalkerPlugin } from "@softmaple/binding-lexical/react";
import { CoreEditor } from "@softmaple/editor/components/core/CoreEditor";
import type { LexicalEditor } from "lexical";
import { ShieldCheck } from "lucide-react";
import type { Dispatch, RefObject, SetStateAction } from "react";
import type { RoomPresence } from "./presence";
import { RemoteSelectionLayer } from "./RemoteSelectionLayer";
import type { LexicalRoomState } from "./useLexicalRoom";

interface LexicalDocumentCanvasProps {
  readonly activeEditor: LexicalEditor | undefined;
  readonly binding: LexicalBinding | null;
  readonly editorHostRef: RefObject<HTMLDivElement | null>;
  readonly lexicalConfig: InitialConfigType;
  readonly onBindingChange: (binding: LexicalBinding | null) => void;
  readonly onBindingError: (error: Error) => void;
  readonly onSelectionChange: (selection: StableBlockSelection | null) => void;
  readonly presence: RoomPresence;
  readonly replica: LexicalRoomState["replica"];
  readonly sessionKey: string;
  readonly setActiveEditor: Dispatch<SetStateAction<LexicalEditor | undefined>>;
  readonly visibleError: Error | null;
}

export function LexicalDocumentCanvas({
  activeEditor,
  binding,
  editorHostRef,
  lexicalConfig,
  onBindingChange,
  onBindingError,
  onSelectionChange,
  presence,
  replica,
  sessionKey,
  setActiveEditor,
  visibleError,
}: LexicalDocumentCanvasProps) {
  return (
    <section className="relative mx-auto flex w-full max-w-[1280px] flex-1 px-3 pb-3 md:px-8 md:pb-8">
      <div className="pg-panel relative flex min-h-[620px] w-full flex-col overflow-hidden">
        <div className="pg-panel-header flex items-center justify-between px-4 py-2 font-[family-name:var(--font-mono)] text-[10px] font-medium tracking-[0.14em] text-[var(--pg-ink-muted)] uppercase">
          <span>Collaborative manuscript</span>
          <span className="inline-flex items-center gap-1.5 text-teal-400">
            <ShieldCheck className="size-3.5" aria-hidden />
            v1 schema
          </span>
        </div>

        {replica === null ? (
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
              layoutClassName="pg-lexical-editor mx-0 my-0 max-w-none min-h-full font-normal leading-[1.7] [&_.flex-auto]:w-full [&_.flex-auto]:flex-1 [&_[contenteditable=true]]:min-h-[500px] [&_[contenteditable=true]]:w-full [&_[contenteditable=true]]:px-6 [&_[contenteditable=true]]:py-8 [&_[aria-hidden=true]>div]:left-6 [&_[aria-hidden=true]>div]:right-6 [&_[aria-hidden=true]>div]:top-8 md:[&_[contenteditable=true]]:min-h-[520px] md:[&_[contenteditable=true]]:px-14 md:[&_[contenteditable=true]]:py-12 md:[&_[aria-hidden=true]>div]:left-14 md:[&_[aria-hidden=true]>div]:right-14 md:[&_[aria-hidden=true]>div]:top-12"
            >
              <LexicalEgWalkerPlugin
                replica={replica}
                onBindingChange={onBindingChange}
                onError={onBindingError}
                onSelectionChange={onSelectionChange}
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

        <div className="pg-panel-footer flex items-center justify-between gap-3 px-4 py-2 font-[family-name:var(--font-mono)] text-[9px] tracking-[0.12em] text-[var(--pg-ink-muted)] uppercase">
          <span>Rich text · real-time · local first</span>
          <span className="hidden text-teal-400 sm:inline">
            Stable sequence anchors
          </span>
        </div>
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
  );
}
