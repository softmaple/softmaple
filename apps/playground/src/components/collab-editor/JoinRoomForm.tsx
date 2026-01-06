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
import { type FormEvent, useEffect, useRef } from "react";

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
  const userNameInputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    // Only submit if both fields have values
    if (userName.trim() && joinRoomId.trim()) {
      onSubmit(e);
    }
  };

  // Focus first input on mount
  useEffect(() => {
    // Only focus if the RoomCreationForm isn't visible (to avoid competing focus)
    const roomCreationForm = document.querySelector(
      '[aria-label="Room creation form"]',
    );
    if (!roomCreationForm) {
      userNameInputRef.current?.focus();
    }
  }, []);

  // Handle Enter key globally for the form
  const handleKeyDown = (e: React.KeyboardEvent<HTMLFormElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      const target = e.target as HTMLElement;
      // If we're in an input field and the form is valid, submit
      if (target.tagName === "INPUT" && userName.trim() && joinRoomId.trim()) {
        e.preventDefault();
        handleSubmit(e as unknown as FormEvent);
      }
    }
  };

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
          ref={formRef}
          onSubmit={handleSubmit}
          onKeyDown={handleKeyDown}
          className="space-y-4"
          aria-label="Join room form"
        >
          <div className="space-y-2">
            <Label htmlFor="join-username" className="guofeng-text font-medium">
              Your Name
            </Label>
            <Input
              id="join-username"
              ref={userNameInputRef}
              type="text"
              placeholder="Enter your name"
              value={userName}
              onChange={(e) => onUserNameChange(e.target.value)}
              required
              aria-required="true"
              aria-describedby="join-username-desc"
              aria-invalid={userName.length > 0 && !userName.trim()}
              className="guofeng-input guofeng-hover guofeng-focus"
              autoComplete="name"
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
              aria-invalid={joinRoomId.length > 0 && !joinRoomId.trim()}
              className="guofeng-input guofeng-hover guofeng-focus"
              autoComplete="off"
            />
            <span id="room-id-desc" className="sr-only">
              Enter the ID of the room you want to join
            </span>
          </div>
          <Button
            type="submit"
            className="w-full guofeng-btn-primary guofeng-btn"
            disabled={isLoading || !userName.trim() || !joinRoomId.trim()}
            aria-busy={isLoading}
            aria-disabled={isLoading || !userName.trim() || !joinRoomId.trim()}
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
