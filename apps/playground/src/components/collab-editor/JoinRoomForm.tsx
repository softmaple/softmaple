import { Button } from "@softmaple/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@softmaple/ui/components/card";
import { Input } from "@softmaple/ui/components/input";
import { Label } from "@softmaple/ui/components/label";
import { Loader2 } from "lucide-react";
import type { FormEvent } from "react";

interface JoinRoomFormProps {
  userName: string;
  joinRoomId: string;
  isLoading: boolean;
  onUserNameChange: (value: string) => void;
  onRoomIdChange: (value: string) => void;
  onSubmit: (e: FormEvent) => void;
}

export function JoinRoomForm({
  userName,
  joinRoomId,
  isLoading,
  onUserNameChange,
  onRoomIdChange,
  onSubmit,
}: JoinRoomFormProps) {
  return (
    <Card
      className="w-full max-w-md"
      role="region"
      aria-label="Join existing room"
    >
      <CardHeader>
        <CardTitle>Join a Room</CardTitle>
        <CardDescription>
          Enter a room ID to join an existing session
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={onSubmit}
          className="space-y-4"
          aria-label="Join room form"
        >
          <div className="space-y-2">
            <Label htmlFor="join-username">Your Name</Label>
            <Input
              id="join-username"
              type="text"
              placeholder="Enter your name"
              value={userName}
              onChange={(e) => onUserNameChange(e.target.value)}
              required
              aria-required="true"
              aria-describedby="join-username-desc"
            />
            <span id="join-username-desc" className="sr-only">
              Enter your display name for this session
            </span>
          </div>
          <div className="space-y-2">
            <Label htmlFor="room-id">Room ID</Label>
            <Input
              id="room-id"
              type="text"
              placeholder="Enter room ID"
              value={joinRoomId}
              onChange={(e) => onRoomIdChange(e.target.value)}
              required
              aria-required="true"
              aria-describedby="room-id-desc"
            />
            <span id="room-id-desc" className="sr-only">
              Enter the ID of the room you want to join
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
                <span>Joining...</span>
              </>
            ) : (
              "Join Room"
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
