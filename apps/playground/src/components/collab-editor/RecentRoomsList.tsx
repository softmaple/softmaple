import { Button } from "@softmaple/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@softmaple/ui/card";
import { ScrollArea } from "@softmaple/ui/scroll-area";
import { Skeleton } from "@softmaple/ui/skeleton";
import { Clock } from "lucide-react";
import type { Room } from "../../modules/collab-editor/types";

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
    <Card className="w-full max-w-md" role="region" aria-label="Recent rooms">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Clock className="h-5 w-5" aria-hidden="true" />
          Recent Rooms
        </CardTitle>
        <CardDescription>
          Quick access to your previous sessions
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <span className="sr-only">Loading recent rooms...</span>
          </div>
        ) : rooms.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            No recent rooms found
          </p>
        ) : (
          <ScrollArea className="max-h-[200px]">
            <ul className="space-y-2" aria-label="List of recent rooms">
              {rooms.map((room) => (
                <li key={room.id}>
                  <Button
                    variant="outline"
                    className="w-full justify-between text-left"
                    onClick={() => onJoinRoom(room.id)}
                    aria-label={`Join room ${room.name}`}
                  >
                    <span className="truncate">{room.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {room.id.slice(0, 8)}...
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
