import { EgWalkerAPI } from "@softmaple/eg-walker";
import { storage } from "./storage";
import { SyncAdapter } from "./sync-adapter";
import type { Document, Room, SyncMessage, User } from "./types";

/**
 * Manages room state and synchronization
 */
export class RoomManager {
  private api: EgWalkerAPI | null = null;
  private syncAdapter: SyncAdapter | null = null;
  private currentRoom: Room | null = null;
  private currentUser: User | null = null;
  private participants = new Map<string, User>();
  private lastSyncedVersion = 0;

  constructor(private wsUrl?: string) {}

  async init(): Promise<void> {
    await storage.init();
  }

  async createRoom(name: string, user: User): Promise<Room> {
    const room: Room = {
      id: this.generateRoomId(),
      name,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await storage.saveRoom(room);
    await this.joinRoom(room.id, user);

    return room;
  }

  async joinRoom(roomId: string, user: User): Promise<boolean> {
    const room = await storage.getRoom(roomId);
    if (!room) return false;

    this.currentRoom = room;
    this.currentUser = user;

    // Initialize CRDT
    this.api = new EgWalkerAPI(user.id);

    // Load existing document
    const doc = await storage.getDocument(roomId);
    if (doc?.events) {
      // Apply existing events
      for (const event of doc.events) {
        try {
          await this.api.applyRemoteEvent(event);
        } catch (error) {
          console.error("Failed to apply event:", error);
        }
      }
      this.lastSyncedVersion = doc.version;
    }

    // Initialize sync adapter
    this.initSyncAdapter(roomId, user);

    // Send join message
    this.syncAdapter?.send({
      type: "join",
      roomId,
      userId: user.id,
      data: user,
      timestamp: Date.now(),
    });

    // Request sync from other participants
    this.syncAdapter?.send({
      type: "sync-request",
      roomId,
      userId: user.id,
      data: { version: this.lastSyncedVersion },
      timestamp: Date.now(),
    });

    return true;
  }

  private initSyncAdapter(_roomId: string, user: User): void {
    this.syncAdapter = new SyncAdapter(this.wsUrl);

    this.syncAdapter.on("user-joined", (msg: SyncMessage) => {
      if (msg.userId !== user.id) {
        this.participants.set(msg.userId, msg.data as User);
        this.onParticipantsChange();
      }
    });

    this.syncAdapter.on("user-left", (msg: SyncMessage) => {
      this.participants.delete(msg.userId);
      this.onParticipantsChange();
    });

    this.syncAdapter.on("remote-event", async (msg: SyncMessage) => {
      if (msg.userId !== user.id && this.api && msg.type === "event") {
        try {
          await this.api.applyRemoteEvent(msg.data);
          this.onContentChange();
          await this.saveDocument();
        } catch (error) {
          console.error("Failed to apply remote event:", error);
        }
      }
    });

    this.syncAdapter.on("sync-request", (msg: SyncMessage) => {
      if (msg.userId !== user.id) {
        this.handleSyncRequest(msg);
      }
    });

    this.syncAdapter.on("sync-response", async (msg: SyncMessage) => {
      if (msg.userId !== user.id) {
        await this.handleSyncResponse(msg);
      }
    });
  }

  private async handleSyncRequest(msg: SyncMessage): Promise<void> {
    if (!this.api || !this.currentRoom) return;
    if (msg.type !== "sync-request") return;

    const events = this.api.exportEventGraph();
    const requestVersion = msg.data.version || 0;

    // Send only events after the requested version
    const newEvents = events.slice(requestVersion);

    if (newEvents.length > 0) {
      this.syncAdapter?.send({
        type: "sync-response",
        roomId: this.currentRoom.id,
        userId: this.currentUser?.id,
        data: { events: newEvents, version: events.length },
        timestamp: Date.now(),
      });
    }
  }

  private async handleSyncResponse(msg: SyncMessage): Promise<void> {
    if (!this.api) return;
    if (msg.type !== "sync-response") return;

    const { events, version } = msg.data;
    if (events && Array.isArray(events)) {
      for (const event of events) {
        try {
          await this.api.applyRemoteEvent(event);
        } catch (error) {
          console.error("Failed to apply sync event:", error);
        }
      }

      this.lastSyncedVersion = version;
      this.onContentChange();
      await this.saveDocument();
    }
  }

  async handleLocalChange(
    operation: "insert" | "delete",
    position: number,
    text?: string,
    length?: number,
  ): Promise<void> {
    if (!this.api || !this.currentRoom) return;

    // Apply operation locally
    if (operation === "insert" && text) {
      this.api.insert(position, text);
    } else if (operation === "delete" && length) {
      this.api.delete(position, length);
    }

    // Get the latest event
    const events = this.api.exportEventGraph();
    const latestEvent = events[events.length - 1];

    if (latestEvent) {
      // Broadcast to other participants
      this.syncAdapter?.send({
        type: "event",
        roomId: this.currentRoom.id,
        userId: this.currentUser?.id,
        data: latestEvent,
        timestamp: Date.now(),
      });

      // Save to local storage
      await this.saveDocument();
    }
  }

  private async saveDocument(): Promise<void> {
    if (!this.api || !this.currentRoom) return;

    const events = this.api.exportEventGraph();
    const doc: Document = {
      roomId: this.currentRoom.id,
      content: this.api.getText(),
      version: events.length,
      events: Array.from(events),
    };

    await storage.saveDocument(doc);
  }

  getText(): string {
    return this.api?.getText() || "";
  }

  insert(position: number, text: string): void {
    this.handleLocalChange("insert", position, text).catch(console.error);
  }

  delete(position: number, length: number): void {
    this.handleLocalChange("delete", position, undefined, length).catch(
      console.error,
    );
  }

  replace(position: number, length: number, text: string): void {
    // Replace is a delete followed by an insert
    this.delete(position, length);
    this.insert(position, text);
  }

  getParticipants(): User[] {
    return Array.from(this.participants.values());
  }

  getCurrentRoom(): Room | null {
    return this.currentRoom;
  }

  getCurrentUser(): User | null {
    return this.currentUser;
  }

  async leaveRoom(): Promise<void> {
    if (this.currentRoom && this.currentUser) {
      this.syncAdapter?.send({
        type: "leave",
        roomId: this.currentRoom.id,
        userId: this.currentUser.id,
        timestamp: Date.now(),
      });
    }

    this.syncAdapter?.disconnect();
    this.syncAdapter = null;
    this.api = null;
    this.currentRoom = null;
    this.participants.clear();
  }

  private generateRoomId(): string {
    return Math.random().toString(36).substring(2, 9);
  }

  // Event handlers to be overridden
  onContentChange(): void {}
  onParticipantsChange(): void {}
}
