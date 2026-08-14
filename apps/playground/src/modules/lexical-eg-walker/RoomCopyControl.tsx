import { Check, Copy } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

interface RoomCopyControlProps {
  readonly roomId: string;
  readonly onCopyRoomLink: () => void;
}

export function RoomCopyControl({
  roomId,
  onCopyRoomLink,
}: RoomCopyControlProps) {
  const [copied, setCopied] = useState(false);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (resetTimerRef.current !== null) {
        clearTimeout(resetTimerRef.current);
      }
    },
    [],
  );

  const copyRoomLink = useCallback(() => {
    onCopyRoomLink();
    setCopied(true);
    if (resetTimerRef.current !== null) {
      clearTimeout(resetTimerRef.current);
    }
    resetTimerRef.current = setTimeout(() => setCopied(false), 2_000);
  }, [onCopyRoomLink]);

  return (
    <span className="inline-flex shrink-0 items-center gap-2">
      <button
        type="button"
        className="pg-focus-ring group inline-flex min-h-11 max-w-52 items-center gap-1.5 px-2 text-[var(--pg-ink)] transition-colors hover:bg-[var(--pg-elevated)] active:translate-y-px"
        onClick={copyRoomLink}
        aria-label={`Copy link for room ${roomId}`}
      >
        <span className="truncate font-mono">room/{roomId}</span>
        {copied ? (
          <Check className="size-3.5 shrink-0 text-teal-400" aria-hidden />
        ) : (
          <Copy
            className="size-3 shrink-0 opacity-50 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
            aria-hidden
          />
        )}
      </button>
      <span
        className={
          copied
            ? "border border-teal-400/25 bg-teal-400/10 px-2 py-1 text-[10px] font-semibold whitespace-nowrap text-teal-300"
            : "sr-only"
        }
        aria-live="polite"
        aria-atomic="true"
      >
        {copied ? "Copied" : ""}
      </span>
    </span>
  );
}
