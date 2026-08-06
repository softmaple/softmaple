import { Button } from "@softmaple/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@softmaple/ui/components/card";
import { ScrollArea } from "@softmaple/ui/components/scroll-area";
import { Clock } from "lucide-react";
import { useRef } from "react";
import type { Room } from "../../modules/collab-editor/types";

const ROOM_ID_PREVIEW_LENGTH = 8;

interface RecentRoomsListProps {
  rooms: Room[];
  isLoading: boolean;
  onJoinRoom: (roomId: string) => void;
}

export function RecentRoomsList({
  rooms,
  isLoading,
  onJoinRoom,
}: RecentRoomsListProps) {
  const listRef = useRef<HTMLUListElement>(null);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLUListElement>) => {
    const target = e.target as HTMLElement;
    const buttons = listRef.current?.querySelectorAll("button");

    if (!buttons || buttons.length === 0) return;

    const currentIndex = Array.from(buttons).indexOf(
      target as HTMLButtonElement,
    );

    switch (e.key) {
      case "ArrowDown":
      case "ArrowRight":
        e.preventDefault();
        if (currentIndex < buttons.length - 1) {
          (buttons[currentIndex + 1] as HTMLButtonElement).focus();
        } else {
          (buttons[0] as HTMLButtonElement).focus();
        }
        break;
      case "ArrowUp":
      case "ArrowLeft":
        e.preventDefault();
        if (currentIndex > 0) {
          (buttons[currentIndex - 1] as HTMLButtonElement).focus();
        } else {
          (buttons[buttons.length - 1] as HTMLButtonElement).focus();
        }
        break;
      case "Home":
        e.preventDefault();
        (buttons[0] as HTMLButtonElement).focus();
        break;
      case "End":
        e.preventDefault();
        (buttons[buttons.length - 1] as HTMLButtonElement).focus();
        break;
    }
  };

  return (
    <Card
      className="pg-panel w-full max-w-md rounded-none border-[var(--pg-line)] bg-[var(--pg-surface)] shadow-none"
      role="region"
      aria-label="Recent rooms"
    >
      <CardHeader>
        <CardTitle className="flex items-center gap-2 font-[family-name:var(--font-display)] text-xl font-semibold tracking-[-0.02em] text-[var(--pg-ink)]">
          <Clock className="h-5 w-5" aria-hidden="true" />
          Recent Rooms
        </CardTitle>
        <CardDescription className="text-[var(--pg-ink-muted)]">
          Quick access to your previous sessions
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            <span className="sr-only">Loading recent rooms...</span>
            <div className="pg-skeleton h-10 w-full" />
            <div className="pg-skeleton h-10 w-full" />
            <div className="pg-skeleton h-10 w-full" />
          </div>
        ) : rooms.length === 0 ? (
          <p className="py-4 text-center text-sm text-[var(--pg-ink-muted)]">
            No recent rooms found
          </p>
        ) : (
          <ScrollArea className="max-h-[200px]">
            <ul
              ref={listRef}
              className="space-y-2"
              aria-label="List of recent rooms"
              onKeyDown={handleKeyDown}
            >
              {rooms.map((room) => (
                <li key={room.id}>
                  <Button
                    variant="ghost"
                    className="pg-btn-ghost w-full justify-between text-left"
                    onClick={() => onJoinRoom(room.id)}
                    aria-label={`Join room ${room.name}`}
                    tabIndex={0}
                  >
                    <span className="truncate text-[var(--pg-ink)]">
                      {room.name}
                    </span>
                    <span className="font-[family-name:var(--font-mono)] text-xs text-[var(--pg-ink-muted)]">
                      {room.id && room.id.length > ROOM_ID_PREVIEW_LENGTH
                        ? `${room.id.slice(0, ROOM_ID_PREVIEW_LENGTH)}...`
                        : room.id || ""}
                    </span>
                  </Button>
                </li>
              ))}
            </ul>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
