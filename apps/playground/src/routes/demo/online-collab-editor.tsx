import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { CollabTextEditor } from "@/components/collab-editor/CollabTextEditor";
import { JoinRoomForm } from "@/components/collab-editor/JoinRoomForm";
import { RecentRoomsList } from "@/components/collab-editor/RecentRoomsList";
import { RoomCreationForm } from "@/components/collab-editor/RoomCreationForm";
import { RoomHeader } from "@/components/collab-editor/RoomHeader";
import { useCollabEditor } from "@/modules/collab-editor/hooks/use-collab-editor";
import { useRecentRooms } from "@/modules/collab-editor/hooks/use-recent-rooms";
import { useTextChange } from "@/modules/collab-editor/hooks/use-text-change";
import "@/styles/guofeng.css";

export const Route = createFileRoute("/demo/online-collab-editor")({
  component: OnlineCollabEditor,
});

function OnlineCollabEditor() {
  const [userName, setUserName] = useState("");
  const [roomName, setRoomName] = useState("");
  const [joinRoomId, setJoinRoomId] = useState("");
  const [hasJoined, setHasJoined] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const {
    roomManager,
    currentRoom,
    text,
    participants,
    isLoading,
    error,
    createRoom,
    joinRoom,
    leaveRoom,
  } = useCollabEditor();

  const { recentRooms, isLoadingRooms } = useRecentRooms();
  // No need for a callback here - useCollabEditor already handles text updates
  const { handleTextChange } = useTextChange(roomManager);

  // Check URL params for room ID
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const roomId = urlParams.get("room");
    if (roomId) {
      setJoinRoomId(roomId);
    }
  }, []);

  const handleCreateRoom = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const roomId = await createRoom(roomName, userName);
      if (roomId) {
        setHasJoined(true);
        // Update URL with room ID
        window.history.replaceState(
          null,
          "",
          `${window.location.pathname}?room=${roomId}`,
        );
      }
    },
    [createRoom, roomName, userName],
  );

  const handleJoinRoom = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const success = await joinRoom(joinRoomId, userName);
      if (success) {
        setHasJoined(true);
        // Update URL with room ID
        window.history.replaceState(
          null,
          "",
          `${window.location.pathname}?room=${joinRoomId}`,
        );
      }
    },
    [joinRoom, joinRoomId, userName],
  );

  const handleLeaveRoom = useCallback(async () => {
    await leaveRoom();
    setHasJoined(false);
    // Clear URL params
    window.history.replaceState(null, "", window.location.pathname);
  }, [leaveRoom]);

  const handleTextAreaChange = useCallback(
    async (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newText = e.target.value;

      // Save cursor position
      const cursorPos = e.target.selectionStart;

      handleTextChange(newText);

      // Restore cursor position
      setTimeout(() => {
        if (textareaRef.current) {
          const safePos = Math.min(cursorPos, newText.length);
          textareaRef.current.setSelectionRange(safePos, safePos);
        }
      }, 0);
    },
    [handleTextChange],
  );

  // Show error toast
  useEffect(() => {
    if (error) {
      toast.error(error);
    }
  }, [error]);

  // Room creation/joining view
  if (!hasJoined) {
    return (
      <div className="min-h-screen guofeng-paper guofeng-ink-wash relative flex items-center justify-center p-4">
        <div className="max-w-4xl w-full relative z-10">
          <h1 className="text-4xl font-bold guofeng-heading text-center mb-2 flex items-center justify-center gap-3">
            <span className="guofeng-seal transform-none text-base">墨</span>
            Online Collaborative Editor
          </h1>
          <p className="guofeng-text text-center mb-8">
            Create a room to start collaborating or join an existing one
          </p>
          <div className="guofeng-divider"></div>

          <div className="grid md:grid-cols-2 gap-6">
            <RoomCreationForm
              userName={userName}
              roomName={roomName}
              onUserNameChange={setUserName}
              onRoomNameChange={setRoomName}
              onSubmit={handleCreateRoom}
              isLoading={isLoading}
            />

            <JoinRoomForm
              userName={userName}
              joinRoomId={joinRoomId}
              onUserNameChange={setUserName}
              onRoomIdChange={setJoinRoomId}
              onSubmit={handleJoinRoom}
              isLoading={isLoading}
            />
          </div>

          <RecentRoomsList
            rooms={recentRooms}
            isLoading={isLoadingRooms}
            onJoinRoom={setJoinRoomId}
          />
        </div>
      </div>
    );
  }

  // Collaboration view
  return (
    <div className="flex flex-col min-h-screen guofeng-paper guofeng-ink-wash relative">
      <div className="container mx-auto p-4 flex-1 flex flex-col">
        <RoomHeader
          currentRoom={currentRoom}
          participants={participants}
          onLeaveRoom={handleLeaveRoom}
        />

        <CollabTextEditor
          text={text}
          participants={participants}
          textareaRef={textareaRef}
          onChange={handleTextAreaChange}
        />
      </div>
    </div>
  );
}

export default OnlineCollabEditor;
