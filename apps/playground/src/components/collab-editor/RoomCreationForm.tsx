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
  const userNameInputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (userName.trim() && roomName.trim()) {
      onSubmit(e);
    }
  };

  useEffect(() => {
    userNameInputRef.current?.focus();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLFormElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" && userName.trim() && roomName.trim()) {
        e.preventDefault();
        handleSubmit(e as unknown as FormEvent);
      }
    }
  };

  return (
    <Card
      className="pg-panel w-full max-w-md rounded-none border-[var(--pg-line)] bg-[var(--pg-surface)] shadow-none"
      role="region"
      aria-label="Create a new room"
    >
      <CardHeader>
        <CardTitle className="font-[family-name:var(--font-display)] text-xl font-semibold tracking-[-0.02em] text-[var(--pg-ink)]">
          Create a Room
        </CardTitle>
        <CardDescription className="text-[var(--pg-ink-muted)]">
          Start a new collaborative editing session
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={handleSubmit}
          onKeyDown={handleKeyDown}
          className="space-y-4"
          aria-label="Room creation form"
        >
          <div className="space-y-2">
            <Label
              htmlFor="create-username"
              className="font-medium text-[var(--pg-ink)]"
            >
              Your Name
            </Label>
            <Input
              id="create-username"
              ref={userNameInputRef}
              type="text"
              placeholder="Enter your name"
              value={userName}
              onChange={(e) => onUserNameChange(e.target.value)}
              required
              aria-required="true"
              aria-describedby="create-username-desc"
              aria-invalid={userName.length > 0 && !userName.trim()}
              className="pg-input"
              autoComplete="name"
            />
            <span id="create-username-desc" className="sr-only">
              Enter your display name for this session
            </span>
          </div>
          <div className="space-y-2">
            <Label
              htmlFor="room-name"
              className="font-medium text-[var(--pg-ink)]"
            >
              Room Name
            </Label>
            <Input
              id="room-name"
              type="text"
              placeholder="Enter room name"
              value={roomName}
              onChange={(e) => onRoomNameChange(e.target.value)}
              required
              aria-required="true"
              aria-describedby="room-name-desc"
              aria-invalid={roomName.length > 0 && !roomName.trim()}
              className="pg-input"
              autoComplete="off"
            />
            <span id="room-name-desc" className="sr-only">
              Choose a name for your collaborative room
            </span>
          </div>
          <Button
            type="submit"
            className="pg-btn-primary w-full"
            disabled={isLoading || !userName.trim() || !roomName.trim()}
            aria-busy={isLoading}
            aria-disabled={isLoading || !userName.trim() || !roomName.trim()}
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
