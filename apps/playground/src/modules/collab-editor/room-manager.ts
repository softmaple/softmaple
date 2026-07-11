import { EgWalkerReplica } from "@softmaple/eg-walker";
import { storage } from "./storage";
import { SyncAdapter } from "./sync-adapter";
import {
  createSyncState,
  decodeStoredEvents,
  decodeWireEvent,
  decodeWireEvents,
  encodeWireEvent,
  selectMissingWireEvents,
} from "./sync-protocol";
import type { Document, Room, SyncMessage, User } from "./types";

/**
 * Manages room state and synchronization
 */
export class RoomManager {
  private api: EgWalkerReplica | null = null;
  private syncAdapter: SyncAdapter | null = null;
  private currentRoom: Room | null = null;
  private currentUser: User | null = null;
  private participants = new Map<string, User>();
  private disableSync: boolean;
  private contentChangeListeners = new Set<() => void>();
  private participantsChangeListeners = new Set<() => void>();

  constructor(
    private wsUrl?: string,
    options?: { disableSync?: boolean },
  ) {
    this.disableSync = options?.disableSync ?? false;
  }

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

    try {
      await storage.saveRoom(room);
      await this.joinRoom(room.id, user);
    } catch (error) {
      console.error("Failed to create room:", error);
      // Re-throw with more context
      throw new Error(
        `Failed to create room: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }

    return room;
  }

  async joinRoom(roomId: string, user: User): Promise<boolean> {
    const room = await storage.getRoom(roomId);
    if (!room) return false;

    this.currentRoom = room;
    this.currentUser = user;

    // Initialize CRDT
    this.api = new EgWalkerReplica(user.id);

    // Load existing document
    const doc = await storage.getDocument(roomId);
    if (doc?.events) {
      try {
        this.api.applyRemoteEvents(decodeStoredEvents(doc.events));
      } catch (error) {
        console.error("Failed to apply stored events:", error);
      }
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
      data: createSyncState(this.api.exportEventGraph()),
      timestamp: Date.now(),
    });

    // Notify that participants have changed (current user joined)
    this.notifyParticipantsChange();

    return true;
  }

  private initSyncAdapter(_roomId: string, user: User): void {
    // Skip sync adapter initialization if sync is disabled (e.g., in tests)
    if (this.disableSync) {
      return;
    }

    this.syncAdapter = new SyncAdapter(this.wsUrl);

    this.syncAdapter.on("user-joined", (msg: SyncMessage) => {
      if (msg.userId !== user.id) {
        this.participants.set(msg.userId, msg.data as User);
        this.notifyParticipantsChange();

        // Send our presence back to the new joiner
        this.syncAdapter?.send({
          type: "join",
          roomId: this.currentRoom?.id || "",
          userId: user.id,
          data: user,
          timestamp: Date.now(),
        });
      }
    });

    this.syncAdapter.on("user-left", (msg: SyncMessage) => {
      this.participants.delete(msg.userId);
      this.notifyParticipantsChange();
    });

    this.syncAdapter.on("remote-event", async (msg: SyncMessage) => {
      if (msg.userId !== user.id && this.api && msg.type === "event") {
        try {
          this.api.applyRemoteEvents([decodeWireEvent(msg.data)]);
          this.notifyContentChange();
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
    const state = createSyncState(events);
    this.syncAdapter?.send({
      type: "sync-response",
      roomId: this.currentRoom.id,
      userId: this.currentUser?.id ?? "",
      data: {
        frontier: state.frontier,
        events: selectMissingWireEvents(events, msg.data.knownEventIds),
      },
      timestamp: Date.now(),
    });

    // Also send our user info as part of sync
    if (this.currentUser) {
      this.syncAdapter?.send({
        type: "join",
        roomId: this.currentRoom.id,
        userId: this.currentUser.id,
        data: this.currentUser,
        timestamp: Date.now(),
      });
    }
  }

  private async handleSyncResponse(msg: SyncMessage): Promise<void> {
    if (!this.api) return;
    if (msg.type !== "sync-response") return;

    const { events } = msg.data;
    if (events && Array.isArray(events)) {
      try {
        this.api.applyRemoteEvents(decodeWireEvents(events));
      } catch (error) {
        console.error("Failed to apply sync batch:", error);
        return;
      }
      this.notifyContentChange();
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

    // Notify content change
    this.notifyContentChange();

    // Get the latest event
    const events = this.api.exportEventGraph();
    const latestEvent = events[events.length - 1];

    if (latestEvent) {
      // Broadcast to other participants
      this.syncAdapter?.send({
        type: "event",
        roomId: this.currentRoom.id,
        userId: this.currentUser?.id ?? "",
        data: encodeWireEvent(latestEvent),
        timestamp: Date.now(),
      });

      // Save to local storage
      await this.saveDocument();
    }
  }

  private async saveDocument(): Promise<void> {
    if (!this.api || !this.currentRoom) return;

    const events = this.api.exportEventGraph();
    const state = createSyncState(events);
    const doc: Document = {
      roomId: this.currentRoom.id,
      content: this.api.getText(),
      version: events.length,
      frontier: state.frontier,
      events: events.map(encodeWireEvent),
      lastModified: Date.now(),
    };

    await storage.saveDocument(doc);
  }

  getText(): string {
    return this.api?.getText() || "";
  }

  insert(position: number, text: string): Promise<void> {
    return this.handleLocalChange("insert", position, text);
  }

  delete(position: number, length: number): Promise<void> {
    return this.handleLocalChange("delete", position, undefined, length);
  }

  async replace(position: number, length: number, text: string): Promise<void> {
    // Replace is a delete followed by an insert
    await this.delete(position, length);
    await this.insert(position, text);
  }

  getParticipants(): User[] {
    const allParticipants = Array.from(this.participants.values());
    // Include current user if they exist
    if (this.currentUser) {
      // Add current user at the beginning (they should appear first)
      return [this.currentUser, ...allParticipants];
    }
    return allParticipants;
  }

  getCurrentRoom(): Room | null {
    return this.currentRoom;
  }

  getCurrentUser(): User | null {
    return this.currentUser;
  }

  async leaveRoom(): Promise<void> {
    if (this.currentRoom && this.currentUser) {
      // Send leave message before disconnecting
      // Use a small delay to ensure the message is broadcast
      const leaveMessage: SyncMessage = {
        type: "leave",
        roomId: this.currentRoom.id,
        userId: this.currentUser.id,
        data: undefined,
        timestamp: Date.now(),
      };

      this.syncAdapter?.send(leaveMessage);

      // Give a small delay to ensure the message is sent
      // This is especially important for BroadcastChannel
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    this.syncAdapter?.disconnect();
    this.syncAdapter = null;
    this.api = null;
    this.currentRoom = null;
    this.currentUser = null;
    this.participants.clear();
    this.notifyParticipantsChange();
  }

  private generateRoomId(): string {
    return crypto.randomUUID();
  }

  // Event handlers to be overridden
  /**
   * Add a listener for content changes
   * @returns A function to unsubscribe the listener
   */
  addContentChangeListener(listener: () => void): () => void {
    this.contentChangeListeners.add(listener);
    return () => {
      this.contentChangeListeners.delete(listener);
    };
  }

  /**
   * Notify all registered listeners of content changes
   */
  notifyContentChange(): void {
    for (const listener of this.contentChangeListeners) {
      listener();
    }
  }

  /**
   * Add a listener for participants changes
   * @returns A function to unsubscribe the listener
   */
  addParticipantsChangeListener(listener: () => void): () => void {
    this.participantsChangeListeners.add(listener);
    return () => {
      this.participantsChangeListeners.delete(listener);
    };
  }

  /**
   * Notify all registered listeners of participants changes
   */
  notifyParticipantsChange(): void {
    for (const listener of this.participantsChangeListeners) {
      listener();
    }
  }
}
