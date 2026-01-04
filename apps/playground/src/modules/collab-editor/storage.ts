import Dexie, { type Table } from "dexie";
import type { Document, Room, User } from "./types";

/**
 * Local-first storage layer using Dexie.js (IndexedDB wrapper)
 * Provides a simpler API for IndexedDB operations
 */
export class LocalStorage extends Dexie {
  // Declare tables
  rooms!: Table<Room>;
  documents!: Table<Document>;
  users!: Table<User>;
  participants!: Table<{ roomId: string; userId: string; joinedAt: Date }>;

  constructor() {
    super("collab-editor");

    // Define database schema
    // Note: createdBy is optional and not indexed to avoid primary key issues
    this.version(1).stores({
      rooms: "id, createdAt", // Primary key is 'id', indexed on 'createdAt'
      documents: "roomId, lastModified",
      users: "id, name, color",
      participants: "[roomId+userId], roomId, userId, joinedAt",
    });
  }

  /**
   * Initialize the storage (Dexie handles this automatically on first use)
   */
  async init(): Promise<void> {
    // Dexie automatically opens the database on first operation
    // This method is kept for API compatibility
    await this.open();
  }

  // Room operations
  async saveRoom(room: Room): Promise<void> {
    await this.rooms.put(room);
  }

  async getRoom(roomId: string): Promise<Room | undefined> {
    return await this.rooms.get(roomId);
  }

  async getRoomsByUser(userId: string): Promise<Room[]> {
    // Since createdBy is optional and not indexed, we need to filter manually
    const allRooms = await this.rooms.toArray();
    return allRooms.filter((room) => room.createdBy === userId);
  }

  async getRecentRooms(limit = 10): Promise<Room[]> {
    const rooms = await this.rooms
      .orderBy("createdAt")
      .reverse()
      .limit(limit)
      .toArray();
    return rooms;
  }

  async deleteRoom(roomId: string): Promise<void> {
    await this.transaction(
      "rw",
      this.rooms,
      this.documents,
      this.participants,
      async () => {
        await this.rooms.delete(roomId);
        await this.documents.delete(roomId);
        await this.participants.where("roomId").equals(roomId).delete();
      },
    );
  }

  // Document operations
  async saveDocument(doc: Document): Promise<void> {
    await this.documents.put(doc);
  }

  async getDocument(roomId: string): Promise<Document | undefined> {
    return await this.documents.get(roomId);
  }

  async deleteDocument(roomId: string): Promise<void> {
    await this.documents.delete(roomId);
  }

  // User operations
  async saveUser(user: User): Promise<void> {
    await this.users.put(user);
  }

  async getUser(userId: string): Promise<User | undefined> {
    return await this.users.get(userId);
  }

  async getUsersByRoom(roomId: string): Promise<User[]> {
    const participantRecords = await this.participants
      .where("roomId")
      .equals(roomId)
      .toArray();
    const userIds = participantRecords.map((p) => p.userId);
    const users = await this.users.where("id").anyOf(userIds).toArray();
    return users;
  }

  // Participant operations
  async addParticipant(roomId: string, userId: string): Promise<void> {
    await this.participants.put({
      roomId,
      userId,
      joinedAt: new Date(),
    });
  }

  async removeParticipant(roomId: string, userId: string): Promise<void> {
    await this.participants.where({ roomId, userId }).delete();
  }

  async isParticipant(roomId: string, userId: string): Promise<boolean> {
    const count = await this.participants.where({ roomId, userId }).count();
    return count > 0;
  }

  // Cleanup operations
  async clearAll(): Promise<void> {
    await this.transaction(
      "rw",
      this.rooms,
      this.documents,
      this.users,
      this.participants,
      async () => {
        await this.rooms.clear();
        await this.documents.clear();
        await this.users.clear();
        await this.participants.clear();
      },
    );
  }

  async clearRoom(roomId: string): Promise<void> {
    await this.transaction(
      "rw",
      this.rooms,
      this.documents,
      this.participants,
      async () => {
        await this.rooms.delete(roomId);
        await this.documents.delete(roomId);
        await this.participants.where("roomId").equals(roomId).delete();
      },
    );
  }

  /**
   * Close the database connection
   */
  async closeDb(): Promise<void> {
    this.close();
  }
}

// Create and export a singleton instance
export const storage = new LocalStorage();
