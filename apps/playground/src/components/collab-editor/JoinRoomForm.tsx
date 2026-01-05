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
      className="w-full max-w-md guofeng-scroll guofeng-corner"
      role="region"
      aria-label="Join existing room"
    >
      <CardHeader>
        <CardTitle className="guofeng-heading flex items-center gap-2">
          <span className="text-sm guofeng-seal inline-block">入</span>
          Join a Room
        </CardTitle>
        <CardDescription className="guofeng-text">
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
            <Label htmlFor="join-username" className="guofeng-text font-medium">
              Your Name
            </Label>
            <Input
              id="join-username"
              type="text"
              placeholder="Enter your name"
              value={userName}
              onChange={(e) => onUserNameChange(e.target.value)}
              required
              aria-required="true"
              aria-describedby="join-username-desc"
              className="guofeng-input guofeng-hover guofeng-focus"
            />
            <span id="join-username-desc" className="sr-only">
              Enter your display name for this session
            </span>
          </div>
          <div className="space-y-2">
            <Label htmlFor="room-id" className="guofeng-text font-medium">
              Room ID
            </Label>
            <Input
              id="room-id"
              type="text"
              placeholder="Enter room ID"
              value={joinRoomId}
              onChange={(e) => onRoomIdChange(e.target.value)}
              required
              aria-required="true"
              aria-describedby="room-id-desc"
              className="guofeng-input guofeng-hover guofeng-focus"
            />
            <span id="room-id-desc" className="sr-only">
              Enter the ID of the room you want to join
            </span>
          </div>
          <Button
            type="submit"
            className="w-full guofeng-btn-primary guofeng-btn"
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
