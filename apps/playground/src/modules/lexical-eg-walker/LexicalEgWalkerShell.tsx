import { ArrowLeft, GitFork } from "lucide-react";

export const LexicalEgWalkerHeader = () => (
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
);

export const LexicalRoomLoadingState = () => (
  <div
    className="grid flex-1 place-items-center p-8 text-center"
    data-testid="lexical-room-loading"
  >
    <div>
      <div className="mx-auto mb-4 flex size-10 items-center justify-center rounded-full border border-[#BCC8D8] bg-[#EEF3F7]">
        <span className="size-2 rounded-full bg-[#475BD8] motion-safe:animate-pulse" />
      </div>
      <p className="font-serif text-lg">Replaying the room history…</p>
      <p className="mt-1 text-xs text-[#7A879A]">
        Editing opens after the first converged document is ready.
      </p>
    </div>
  </div>
);
