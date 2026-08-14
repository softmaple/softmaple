import { Link } from "@tanstack/react-router";
import { ArrowLeft, GitFork } from "lucide-react";
import type { LexicalCollabTransportMode } from "./transport";

interface LexicalDocumentHeaderProps {
  readonly transportMode: LexicalCollabTransportMode;
}

export function LexicalDocumentHeader({
  transportMode,
}: LexicalDocumentHeaderProps) {
  return (
    <header className="mx-auto flex w-full max-w-[1280px] items-start justify-between gap-4 px-4 pt-5 pb-4 md:px-8 md:pt-7 md:pb-5">
      <div className="min-w-0">
        <div className="mb-1.5 flex items-center gap-2 font-[family-name:var(--font-mono)] text-[10px] font-semibold tracking-[0.18em] text-[var(--pg-accent)] uppercase">
          <GitFork className="size-3.5" aria-hidden />
          Causal canvas ·{" "}
          {transportMode === "websocket" ? "WebSocket" : "local first"}
        </div>
        <h1 className="font-[family-name:var(--font-display)] text-2xl leading-tight font-bold tracking-[-0.03em] md:text-4xl">
          EG-walker × Lexical
        </h1>
        <p className="mt-1.5 max-w-2xl text-xs leading-relaxed text-[var(--pg-ink-muted)] md:text-sm">
          {transportMode === "websocket"
            ? "One document across browsers. Document events and presence sync over WebSocket; a local copy remains on this device."
            : "One document, any number of tabs. Changes converge through stable sequence anchors and remain on this device after every tab closes. Add ?transport=websocket for cross-browser sync."}
        </p>
      </div>
      <Link
        to="/"
        className="pg-focus-ring hidden min-h-11 shrink-0 items-center gap-1.5 border border-[var(--pg-line)] bg-[var(--pg-elevated)] px-3 text-xs font-semibold text-[var(--pg-ink-muted)] transition-colors hover:border-[var(--pg-ink-muted)] hover:text-[var(--pg-ink)] active:translate-y-px md:inline-flex"
      >
        <ArrowLeft className="size-3.5" aria-hidden />
        Playground
      </Link>
    </header>
  );
}
