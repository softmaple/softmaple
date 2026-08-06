import { ExternalLink, Share2, X } from "lucide-react";
import { useState } from "react";
import { openAnotherWindow } from "./roomLink";

export interface SoloCollabHintProps {
  readonly roomId: string;
  readonly onShare: () => void;
}

export function SoloCollabHint({ roomId, onShare }: SoloCollabHintProps) {
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  return (
    <div
      className="pointer-events-auto absolute right-3 bottom-3 left-3 z-10 max-w-sm border border-[var(--pg-line)] bg-[var(--pg-surface)]/96 p-3 shadow-sm backdrop-blur md:left-auto"
      data-testid="solo-collab-hint"
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-[var(--pg-ink)]">
            You’re the only person here.
          </p>
          <p className="mt-1 text-xs leading-relaxed text-[var(--pg-ink-muted)]">
            Open another window or share this room to test collaboration.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              className="inline-flex items-center gap-1.5 bg-[var(--pg-ink)] px-2.5 py-1.5 text-xs font-semibold text-[var(--pg-paper)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--pg-accent)]"
              onClick={() => {
                openAnotherWindow(roomId);
              }}
              data-testid="solo-open-window"
            >
              <ExternalLink className="size-3.5" aria-hidden />
              Open another window
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-1.5 border border-[var(--pg-line)] px-2.5 py-1.5 text-xs font-semibold text-[var(--pg-ink)] outline-none hover:border-[var(--pg-ink)] focus-visible:ring-2 focus-visible:ring-[var(--pg-accent)]"
              onClick={onShare}
              data-testid="solo-share"
            >
              <Share2 className="size-3.5" aria-hidden />
              Share room
            </button>
          </div>
        </div>
        <button
          type="button"
          className="shrink-0 p-0.5 text-[var(--pg-ink-muted)] outline-none hover:text-[var(--pg-ink)] focus-visible:ring-2 focus-visible:ring-[var(--pg-accent)]"
          onClick={() => setDismissed(true)}
          aria-label="Dismiss"
        >
          <X className="size-3.5" aria-hidden />
        </button>
      </div>
    </div>
  );
}
