import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@softmaple/ui/components/dialog";
import { Copy, ExternalLink } from "lucide-react";
import { useEffect, useState } from "react";
import { buildRoomUrl, copyRoomLink, openAnotherWindow } from "./roomLink";

export interface ShareRoomDialogProps {
  readonly roomId: string;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

export function ShareRoomDialog({
  roomId,
  open,
  onOpenChange,
}: ShareRoomDialogProps) {
  const [link, setLink] = useState("");

  useEffect(() => {
    if (!open) return;
    setLink(buildRoomUrl(roomId));
  }, [open, roomId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="border-[var(--pg-line)] bg-[var(--pg-paper)] text-[var(--pg-ink)] sm:max-w-md"
        data-testid="share-room-dialog"
      >
        <DialogHeader>
          <DialogTitle className="font-[family-name:var(--font-display)] tracking-[-0.02em]">
            Invite someone to this room
          </DialogTitle>
          <DialogDescription className="text-[var(--pg-ink-muted)]">
            Open the link in another browser or window to watch edits sync live.
          </DialogDescription>
        </DialogHeader>

        <div className="overflow-hidden border border-[var(--pg-line)] bg-[var(--pg-surface)] px-3 py-2.5 font-[family-name:var(--font-mono)] text-xs break-all text-[var(--pg-ink)]">
          {link || "…"}
        </div>

        <DialogFooter className="gap-2 sm:justify-start">
          <button
            type="button"
            className="inline-flex items-center justify-center gap-1.5 bg-[var(--pg-ink)] px-3.5 py-2 text-sm font-semibold text-[var(--pg-paper)] outline-none transition-colors hover:opacity-90 focus-visible:ring-2 focus-visible:ring-[var(--pg-accent)]"
            onClick={() => {
              void copyRoomLink(roomId);
            }}
            data-testid="share-copy-link"
          >
            <Copy className="size-3.5" aria-hidden />
            Copy link
          </button>
          <button
            type="button"
            className="inline-flex items-center justify-center gap-1.5 border border-[var(--pg-line)] bg-[var(--pg-surface)] px-3.5 py-2 text-sm font-semibold text-[var(--pg-ink)] outline-none transition-colors hover:border-[var(--pg-ink)] focus-visible:ring-2 focus-visible:ring-[var(--pg-accent)]"
            onClick={() => {
              openAnotherWindow(roomId);
            }}
            data-testid="share-open-window"
          >
            <ExternalLink className="size-3.5" aria-hidden />
            Open another window
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
