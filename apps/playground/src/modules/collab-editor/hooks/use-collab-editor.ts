import { useCallback, useEffect, useState } from "react";
import { RoomManager } from "../room-manager";
import { storage } from "../storage";
import type { Room, User } from "../types";
import { getRandomColor } from "../utils";

export function useCollabEditor(wsUrl?: string) {
  const [roomManager] = useState(() => new RoomManager(wsUrl));
  const [currentRoom, setCurrentRoom] = useState<Room | null>(null);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [text, setText] = useState("");
  const [participants, setParticipants] = useState<User[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Initialize room manager
  useEffect(() => {
    roomManager.init().catch(console.error);

    // Override event handlers
    const unsubscribeContent = roomManager.addContentChangeListener(() => {
      setText(roomManager.getText());
    });

    roomManager.onParticipantsChange = () => {
      setParticipants(roomManager.getParticipants());
    };

    return () => {
      unsubscribeContent();
      roomManager.leaveRoom();
    };
  }, [roomManager]);

  const createRoom = useCallback(
    async (name: string, userName: string) => {
      setIsLoading(true);
      setError(null);

      try {
        const user: User = {
          id: crypto.randomUUID(),
          name: userName,
          color: getRandomColor(),
        };

        await storage.saveUser(user);
        const room = await roomManager.createRoom(name, user);

        setCurrentRoom(room);
        setCurrentUser(user);
        setText(roomManager.getText());
        setIsConnected(true);

        return room.id;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to create room");
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    [roomManager],
  );

  const joinRoom = useCallback(
    async (roomId: string, userName: string) => {
      setIsLoading(true);
      setError(null);

      try {
        const user: User = {
          id: crypto.randomUUID(),
          name: userName,
          color: getRandomColor(),
        };

        await storage.saveUser(user);
        const success = await roomManager.joinRoom(roomId, user);

        if (success) {
          setCurrentRoom(roomManager.getCurrentRoom());
          setCurrentUser(user);
          setText(roomManager.getText());
          setIsConnected(true);
          return true;
        } else {
          setError("Room not found");
          return false;
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to join room");
        return false;
      } finally {
        setIsLoading(false);
      }
    },
    [roomManager],
  );

  const leaveRoom = useCallback(async () => {
    await roomManager.leaveRoom();
    setCurrentRoom(null);
    setCurrentUser(null);
    setText("");
    setParticipants([]);
    setIsConnected(false);
  }, [roomManager]);

  return {
    roomManager,
    currentRoom,
    currentUser,
    text,
    participants,
    isConnected,
    isLoading,
    error,
    createRoom,
    joinRoom,
    leaveRoom,
  };
}
