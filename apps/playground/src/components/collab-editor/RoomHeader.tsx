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
      // Fallback for browsers that don't support clipboard API
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
    <header className="guofeng-header px-4 py-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div>
            <h1 className="text-xl font-semibold guofeng-text-ink">
              {currentRoom.name}
            </h1>
            <p className="text-xs guofeng-text-muted">
              Room ID: {currentRoom.id.slice(0, 8)}...
            </p>
          </div>
          <div
            className="flex items-center gap-2 text-sm guofeng-text-muted"
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
            className="guofeng-button-ghost guofeng-hover-deepen"
          >
            <Copy className="h-4 w-4 mr-1" aria-hidden="true" />
            {copied ? "Copied!" : "Share Link"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={onLeaveRoom}
            className="guofeng-button-seal guofeng-hover-deepen"
          >
            <LogOut className="h-4 w-4 mr-1" aria-hidden="true" />
            Leave
          </Button>
        </div>
      </div>
      <div className="guofeng-brush-divider-horizontal mt-3 opacity-20"></div>
    </header>
  );
}
