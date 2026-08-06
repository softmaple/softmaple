import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { CollabTextEditor } from "@/components/collab-editor/CollabTextEditor";
import { JoinRoomForm } from "@/components/collab-editor/JoinRoomForm";
import { RecentRoomsList } from "@/components/collab-editor/RecentRoomsList";
import { RoomCreationForm } from "@/components/collab-editor/RoomCreationForm";
import { RoomHeader } from "@/components/collab-editor/RoomHeader";
import { DemoPageShell } from "@/components/demo/DemoPageShell";
import { useCollabEditor } from "@/modules/collab-editor/hooks/use-collab-editor";
import { useRecentRooms } from "@/modules/collab-editor/hooks/use-recent-rooms";
import { useTextChange } from "@/modules/collab-editor/hooks/use-text-change";
import { resolveBrowserCollabEndpoints } from "@/modules/collab-transport/urls";

export const Route = createFileRoute("/demo/online-collab-editor")({
  ssr: false,
  component: OnlineCollabEditor,
});

function OnlineCollabEditor() {
  const [userName, setUserName] = useState("");
  const [roomName, setRoomName] = useState("");
  const [joinRoomId, setJoinRoomId] = useState("");
  const [hasJoined, setHasJoined] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const syncWsUrl = useMemo(() => {
    const endpoints = resolveBrowserCollabEndpoints({
      envTransport: import.meta.env.VITE_COLLAB_TRANSPORT,
      syncWsUrl: import.meta.env.VITE_COLLAB_SYNC_WS_URL,
    });
    return endpoints.syncWsUrl ?? undefined;
  }, []);

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
  } = useCollabEditor(syncWsUrl);

  const { recentRooms, isLoadingRooms } = useRecentRooms();
  const { handleTextChange } = useTextChange(roomManager);

  const writeRoomToUrl = useCallback((roomId: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set("room", roomId);
    window.history.replaceState(null, "", `${url.pathname}${url.search}`);
  }, []);

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
        writeRoomToUrl(roomId);
      }
    },
    [createRoom, roomName, userName, writeRoomToUrl],
  );

  const handleJoinRoom = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const success = await joinRoom(joinRoomId, userName);
      if (success) {
        setHasJoined(true);
        writeRoomToUrl(joinRoomId);
      }
    },
    [joinRoom, joinRoomId, userName, writeRoomToUrl],
  );

  const handleLeaveRoom = useCallback(async () => {
    await leaveRoom();
    setHasJoined(false);
    const url = new URL(window.location.href);
    url.searchParams.delete("room");
    window.history.replaceState(null, "", `${url.pathname}${url.search}`);
  }, [leaveRoom]);

  const handleTextAreaChange = useCallback(
    async (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newText = e.target.value;
      const cursorPos = e.target.selectionStart;
      handleTextChange(newText);
      setTimeout(() => {
        if (textareaRef.current) {
          const safePos = Math.min(cursorPos, newText.length);
          textareaRef.current.setSelectionRange(safePos, safePos);
        }
      }, 0);
    },
    [handleTextChange],
  );

  useEffect(() => {
    if (error) {
      toast.error(error);
    }
  }, [error]);

  if (!hasJoined) {
    return (
      <DemoPageShell
        eyebrow="02 · WebSocket rooms"
        title="Online Collaborative Editor"
        description="Create a room to start collaborating or join an existing one."
        contentClassName="max-w-5xl"
      >
        <div className="grid gap-6 md:grid-cols-2">
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
        <div className="mt-6 flex justify-center">
          <RecentRoomsList
            rooms={recentRooms}
            isLoading={isLoadingRooms}
            onJoinRoom={setJoinRoomId}
          />
        </div>
      </DemoPageShell>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-[var(--pg-paper)] text-[var(--pg-ink)]">
      <div className="container mx-auto flex flex-1 flex-col p-4 md:p-6">
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
