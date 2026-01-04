import type { Document, Room, User } from "./types";

/**
 * Local-first storage layer using IndexedDB for persistence
 * Falls back to localStorage for simpler demo environments
 */
export class LocalStorage {
  private readonly DB_NAME = "collab-editor";
  private readonly DB_VERSION = 1;
  private db: IDBDatabase | null = null;

  /**
   * Wraps an IDBRequest in a Promise for proper async/await handling
   */
  private wrapRequest<T>(request: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Waits for a transaction to complete
   */
  private wrapTransaction(tx: IDBTransaction): Promise<void> {
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async init(): Promise<void> {
    if (!("indexedDB" in window)) {
      console.warn("IndexedDB not available, using localStorage fallback");
      return;
    }

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        // Rooms store
        if (!db.objectStoreNames.contains("rooms")) {
          const roomStore = db.createObjectStore("rooms", { keyPath: "id" });
          roomStore.createIndex("updatedAt", "updatedAt", { unique: false });
        }

        // Documents store
        if (!db.objectStoreNames.contains("documents")) {
          const docStore = db.createObjectStore("documents", {
            keyPath: "roomId",
          });
          docStore.createIndex("version", "version", { unique: false });
        }

        // Users store
        if (!db.objectStoreNames.contains("users")) {
          db.createObjectStore("users", { keyPath: "id" });
        }

        // Participants store
        if (!db.objectStoreNames.contains("participants")) {
          const participantStore = db.createObjectStore("participants", {
            keyPath: ["userId", "roomId"],
          });
          participantStore.createIndex("roomId", "roomId", { unique: false });
        }
      };
    });
  }

  // Room operations
  async saveRoom(room: Room): Promise<void> {
    if (this.db) {
      const tx = this.db.transaction(["rooms"], "readwrite");
      const request = tx.objectStore("rooms").put(room);
      await this.wrapRequest(request);
      await this.wrapTransaction(tx);
    } else {
      // Fallback to localStorage
      const rooms = this.getLocalStorageRooms();
      rooms[room.id] = room;
      localStorage.setItem("collab-rooms", JSON.stringify(rooms));
    }
  }

  async getRoom(roomId: string): Promise<Room | null> {
    if (this.db) {
      const tx = this.db.transaction(["rooms"], "readonly");
      const request = tx.objectStore("rooms").get(roomId);
      return new Promise((resolve) => {
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => resolve(null);
      });
    } else {
      const rooms = this.getLocalStorageRooms();
      return rooms[roomId] || null;
    }
  }

  async getAllRooms(): Promise<Room[]> {
    if (this.db) {
      const tx = this.db.transaction(["rooms"], "readonly");
      const request = tx.objectStore("rooms").getAll();
      return new Promise((resolve) => {
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => resolve([]);
      });
    } else {
      return Object.values(this.getLocalStorageRooms());
    }
  }

  async getRecentRooms(limit: number = 10): Promise<Room[]> {
    const rooms = await this.getAllRooms();
    return rooms
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
      .slice(0, limit);
  }

  // Document operations
  async saveDocument(doc: Document): Promise<void> {
    if (this.db) {
      const tx = this.db.transaction(["documents"], "readwrite");
      const request = tx.objectStore("documents").put(doc);
      await this.wrapRequest(request);
      await this.wrapTransaction(tx);
    } else {
      const docs = this.getLocalStorageDocuments();
      docs[doc.roomId] = doc;
      localStorage.setItem("collab-documents", JSON.stringify(docs));
    }
  }

  async getDocument(roomId: string): Promise<Document | null> {
    if (this.db) {
      const tx = this.db.transaction(["documents"], "readonly");
      const request = tx.objectStore("documents").get(roomId);
      return new Promise((resolve) => {
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => resolve(null);
      });
    } else {
      const docs = this.getLocalStorageDocuments();
      return docs[roomId] || null;
    }
  }

  // User operations
  async saveUser(user: User): Promise<void> {
    if (this.db) {
      const tx = this.db.transaction(["users"], "readwrite");
      const request = tx.objectStore("users").put(user);
      await this.wrapRequest(request);
      await this.wrapTransaction(tx);
    } else {
      localStorage.setItem(`user-${user.id}`, JSON.stringify(user));
    }
  }

  async getUser(userId: string): Promise<User | null> {
    if (this.db) {
      const tx = this.db.transaction(["users"], "readonly");
      const request = tx.objectStore("users").get(userId);
      return new Promise((resolve) => {
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => resolve(null);
      });
    } else {
      const userStr = localStorage.getItem(`user-${userId}`);
      return userStr ? JSON.parse(userStr) : null;
    }
  }

  // Helper methods for localStorage fallback
  private getLocalStorageRooms(): Record<string, Room> {
    const roomsStr = localStorage.getItem("collab-rooms");
    return roomsStr ? JSON.parse(roomsStr) : {};
  }

  private getLocalStorageDocuments(): Record<string, Document> {
    const docsStr = localStorage.getItem("collab-documents");
    return docsStr ? JSON.parse(docsStr) : {};
  }

  // Cleanup methods for testing
  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  async clear(): Promise<void> {
    if (this.db) {
      // Clear all object stores
      const storeNames = ["rooms", "documents", "users", "participants"];
      const tx = this.db.transaction(storeNames, "readwrite");

      for (const storeName of storeNames) {
        const request = tx.objectStore(storeName).clear();
        await this.wrapRequest(request);
      }

      await this.wrapTransaction(tx);
    } else {
      // Clear localStorage fallback
      localStorage.removeItem("collab-rooms");
      localStorage.removeItem("collab-documents");
      // Clear all user keys
      const keys = Object.keys(localStorage);
      for (const key of keys) {
        if (key.startsWith("user-")) {
          localStorage.removeItem(key);
        }
      }
    }
  }
}

// Singleton instance
export const storage = new LocalStorage();
