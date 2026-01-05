import { Button } from "@softmaple/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@softmaple/ui/card";
import { Input } from "@softmaple/ui/input";
import { Label } from "@softmaple/ui/label";
import { Loader2 } from "lucide-react";
import type { FormEvent } from "react";

interface RoomCreationFormProps {
  userName: string;
  roomName: string;
  isLoading: boolean;
  onUserNameChange: (value: string) => void;
  onRoomNameChange: (value: string) => void;
  onSubmit: (e: FormEvent) => void;
}

export function RoomCreationForm({
  userName,
  roomName,
  isLoading,
  onUserNameChange,
  onRoomNameChange,
  onSubmit,
}: RoomCreationFormProps) {
  return (
    <Card
      className="w-full max-w-md"
      role="region"
      aria-label="Create a new room"
    >
      <CardHeader>
        <CardTitle>Create a Room</CardTitle>
        <CardDescription>
          Start a new collaborative editing session
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={onSubmit}
          className="space-y-4"
          aria-label="Room creation form"
        >
          <div className="space-y-2">
            <Label htmlFor="create-username">Your Name</Label>
            <Input
              id="create-username"
              type="text"
              placeholder="Enter your name"
              value={userName}
              onChange={(e) => onUserNameChange(e.target.value)}
              required
              aria-required="true"
              aria-describedby="create-username-desc"
            />
            <span id="create-username-desc" className="sr-only">
              Enter your display name for this session
            </span>
          </div>
          <div className="space-y-2">
            <Label htmlFor="room-name">Room Name</Label>
            <Input
              id="room-name"
              type="text"
              placeholder="Enter room name"
              value={roomName}
              onChange={(e) => onRoomNameChange(e.target.value)}
              required
              aria-required="true"
              aria-describedby="room-name-desc"
            />
            <span id="room-name-desc" className="sr-only">
              Choose a name for your collaborative room
            </span>
          </div>
          <Button
            type="submit"
            className="w-full"
            disabled={isLoading}
            aria-busy={isLoading}
          >
            {isLoading ? (
              <>
                <Loader2
                  className="mr-2 h-4 w-4 animate-spin"
                  aria-hidden="true"
                />
                <span>Creating...</span>
              </>
            ) : (
              "Create Room"
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
