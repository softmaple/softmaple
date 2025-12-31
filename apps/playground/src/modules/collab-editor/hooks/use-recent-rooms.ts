import { useState, useEffect } from 'react';
import type { Room } from '../types';
import { storage } from '../storage';

/**
 * Hook for managing recently accessed rooms
 */
export function useRecentRooms() {
  const [recentRooms, setRecentRooms] = useState<Room[]>([]);
  const [isLoadingRooms, setIsLoadingRooms] = useState(false);
  
  // Load recent rooms on mount
  useEffect(() => {
    loadRecentRooms();
  }, []);
  
  const loadRecentRooms = async () => {
    setIsLoadingRooms(true);
    try {
      const rooms = await storage.getRecentRooms(10);
      setRecentRooms(rooms);
    } catch (error) {
      console.error('Failed to load recent rooms:', error);
      setRecentRooms([]);
    } finally {
      setIsLoadingRooms(false);
    }
  };
  
  const addRecentRoom = async (room: Room) => {
    try {
      await storage.saveRoom(room);
      // Update local state optimistically
      setRecentRooms(prev => {
        const filtered = prev.filter(r => r.id !== room.id);
        return [room, ...filtered].slice(0, 10);
      });
    } catch (error) {
      console.error('Failed to save recent room:', error);
    }
  };
  
  const removeRecentRoom = async (roomId: string) => {
    try {
      // Note: We don't actually delete from storage, just filter from display
      setRecentRooms(prev => prev.filter(r => r.id !== roomId));
    } catch (error) {
      console.error('Failed to remove recent room:', error);
    }
  };
  
  const clearRecentRooms = async () => {
    try {
      // Clear from display only
      setRecentRooms([]);
    } catch (error) {
      console.error('Failed to clear recent rooms:', error);
    }
  };
  
  return {
    recentRooms,
    isLoadingRooms,
    loadRecentRooms,
    addRecentRoom,
    removeRecentRoom,
    clearRecentRooms,
  };
}
