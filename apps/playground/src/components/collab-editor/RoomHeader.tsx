import { Button } from "@softmaple/ui/components/button";
import { Copy, LogOut, Users } from "lucide-react";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import type { Room, User } from "@/modules/collab-editor/types";

interface RoomHeaderProps {
  currentRoom: Room | null;
  participants: User[];
  onLeaveRoom: () => void;
}

export function RoomHeader({
  currentRoom,
  participants,
  onLeaveRoom,
}: RoomHeaderProps) {
  const [copied, setCopied] = useState(false);

  const copyRoomLink = useCallback(async () => {
    if (!currentRoom) return;

    const roomLink = `${window.location.origin}/demo/online-collab-editor?room=${currentRoom.id}`;

    try {
      await navigator.clipboard.writeText(roomLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast.success("Room link copied to clipboard", {
        description: roomLink,
        duration: 5000,
      });
    } catch (_error) {
      const textarea = document.createElement("textarea");
      textarea.value = roomLink;
      textarea.style.position = "fixed";
      textarea.style.top = "-9999px";
      document.body.appendChild(textarea);
      textarea.select();
      const successful = document.execCommand("copy");
      document.body.removeChild(textarea);

      if (successful) {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
        toast.success("Room link copied to clipboard");
      } else {
        toast.error("Failed to copy room link", {
          description: `Please copy manually: ${roomLink}`,
          duration: 5000,
        });
      }
    }
  }, [currentRoom]);

  if (!currentRoom) return null;

  return (
    <header className="mb-4 border-b border-[var(--pg-line)] pb-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
          <div>
            <h1 className="font-[family-name:var(--font-display)] text-xl font-semibold tracking-[-0.02em] text-[var(--pg-ink)]">
              {currentRoom.name}
            </h1>
            <p className="font-[family-name:var(--font-mono)] text-xs text-[var(--pg-ink-muted)]">
              Room ID: {currentRoom.id.slice(0, 8)}...
            </p>
          </div>
          <div
            className="flex items-center gap-2 text-sm text-[var(--pg-ink-muted)]"
            aria-live="polite"
          >
            <Users className="h-4 w-4" aria-hidden="true" />
            <span>
              {participants.length}{" "}
              {participants.length === 1 ? "participant" : "participants"}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={copyRoomLink}
            className="pg-btn-ghost"
          >
            <Copy className="mr-1 h-4 w-4" aria-hidden="true" />
            {copied ? "Copied!" : "Share Link"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={onLeaveRoom}
            className="border border-rose-400/30 bg-rose-500/10 text-rose-300 hover:bg-rose-700 hover:text-white"
          >
            <LogOut className="mr-1 h-4 w-4" aria-hidden="true" />
            Leave
          </Button>
        </div>
      </div>
    </header>
  );
}
