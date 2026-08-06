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

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (userName.trim() && joinRoomId.trim()) {
      onSubmit(e);
    }
  };

  useEffect(() => {
    const roomCreationForm = document.querySelector(
      '[aria-label="Room creation form"]',
    );
    if (!roomCreationForm) {
      userNameInputRef.current?.focus();
    }
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLFormElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" && userName.trim() && joinRoomId.trim()) {
        e.preventDefault();
        handleSubmit(e as unknown as FormEvent);
      }
    }
  };

  return (
    <Card
      className="pg-panel w-full max-w-md rounded-none border-[var(--pg-line)] bg-[var(--pg-surface)] shadow-none"
      role="region"
      aria-label="Join existing room"
    >
      <CardHeader>
        <CardTitle className="font-[family-name:var(--font-display)] text-xl font-semibold tracking-[-0.02em] text-[var(--pg-ink)]">
          Join a Room
        </CardTitle>
        <CardDescription className="text-[var(--pg-ink-muted)]">
          Enter a room ID to join an existing session
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={handleSubmit}
          onKeyDown={handleKeyDown}
          className="space-y-4"
          aria-label="Join room form"
        >
          <div className="space-y-2">
            <Label
              htmlFor="join-username"
              className="font-medium text-[var(--pg-ink)]"
            >
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
              className="pg-input"
              autoComplete="name"
            />
            <span id="join-username-desc" className="sr-only">
              Enter your display name for this session
            </span>
          </div>
          <div className="space-y-2">
            <Label
              htmlFor="room-id"
              className="font-medium text-[var(--pg-ink)]"
            >
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
              className="pg-input"
              autoComplete="off"
            />
            <span id="room-id-desc" className="sr-only">
              Enter the ID of the room you want to join
            </span>
          </div>
          <Button
            type="submit"
            className="pg-btn-primary w-full"
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
