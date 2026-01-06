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
    // Only submit if both fields have values
    if (userName.trim() && roomName.trim()) {
      onSubmit(e);
    }
  };

  // Focus first input on mount
  useEffect(() => {
    userNameInputRef.current?.focus();
  }, []);

  // Handle Enter key globally for the form
  const handleKeyDown = (e: React.KeyboardEvent<HTMLFormElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      const target = e.target as HTMLElement;
      // If we're in an input field and the form is valid, submit
      if (target.tagName === "INPUT" && userName.trim() && roomName.trim()) {
        e.preventDefault();
        handleSubmit(e as unknown as FormEvent);
      }
    }
  };

  return (
    <Card
      className="w-full max-w-md guofeng-scroll guofeng-corner"
      role="region"
      aria-label="Create a new room"
    >
      <CardHeader>
        <CardTitle className="guofeng-heading flex items-center gap-2">
          <span className="text-sm guofeng-seal inline-block">创</span>
          Create a Room
        </CardTitle>
        <CardDescription className="guofeng-text">
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
              className="guofeng-text font-medium"
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
              className="guofeng-input guofeng-hover guofeng-focus"
              autoComplete="name"
            />
            <span id="create-username-desc" className="sr-only">
              Enter your display name for this session
            </span>
          </div>
          <div className="space-y-2">
            <Label htmlFor="room-name" className="guofeng-text font-medium">
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
              className="guofeng-input guofeng-hover guofeng-focus"
              autoComplete="off"
            />
            <span id="room-name-desc" className="sr-only">
              Choose a name for your collaborative room
            </span>
          </div>
          <Button
            type="submit"
            className="w-full guofeng-btn-primary guofeng-btn"
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
