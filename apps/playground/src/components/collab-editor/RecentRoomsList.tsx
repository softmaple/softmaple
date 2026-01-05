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
  return (
    <Card
      className="w-full max-w-md guofeng-card guofeng-shadow-hover"
      role="region"
      aria-label="Recent rooms"
    >
      <CardHeader>
        <CardTitle className="flex items-center gap-2 guofeng-text-ink">
          <Clock className="h-5 w-5" aria-hidden="true" />
          Recent Rooms
        </CardTitle>
        <CardDescription className="guofeng-text-muted">
          Quick access to your previous sessions
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            <span className="sr-only">Loading recent rooms...</span>
            <div className="h-10 w-full guofeng-skeleton rounded" />
            <div className="h-10 w-full guofeng-skeleton rounded" />
            <div className="h-10 w-full guofeng-skeleton rounded" />
          </div>
        ) : rooms.length === 0 ? (
          <p className="text-sm guofeng-text-muted text-center py-4">
            No recent rooms found
          </p>
        ) : (
          <ScrollArea className="max-h-[200px]">
            <div className="guofeng-brush-divider-horizontal mb-2 opacity-30"></div>
            <ul className="space-y-2" aria-label="List of recent rooms">
              {rooms.map((room) => (
                <li key={room.id}>
                  <Button
                    variant="ghost"
                    className="w-full justify-between text-left guofeng-button-ghost guofeng-hover-deepen"
                    onClick={() => onJoinRoom(room.id)}
                    aria-label={`Join room ${room.name}`}
                  >
                    <span className="truncate guofeng-text-ink">
                      {room.name}
                    </span>
                    <span className="text-xs guofeng-text-muted guofeng-badge-minimal">
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
