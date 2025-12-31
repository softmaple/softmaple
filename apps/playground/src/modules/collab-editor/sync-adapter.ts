import { EventEmitter } from "eventemitter3";
import type { SyncMessage } from "./types";

/**
 * WebSocket sync adapter for real-time collaboration
 * In demo mode, uses BroadcastChannel for local multi-tab sync
 */
export class SyncAdapter extends EventEmitter {
  private ws: WebSocket | null = null;
  private broadcastChannel: BroadcastChannel | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private isConnected = false;
  private readonly wsUrl: string;
  private readonly useBroadcastChannel: boolean;

  constructor(wsUrl?: string) {
    super();
    // Use BroadcastChannel for demo if no WebSocket URL provided
    this.useBroadcastChannel = !wsUrl;
    this.wsUrl = wsUrl || "";

    if (this.useBroadcastChannel && "BroadcastChannel" in window) {
      this.initBroadcastChannel();
    } else if (wsUrl) {
      this.connect();
    }
  }

  private initBroadcastChannel(): void {
    this.broadcastChannel = new BroadcastChannel("collab-editor-sync");
    this.broadcastChannel.onmessage = (event) => {
      this.handleMessage(event.data);
    };
    this.isConnected = true;
    this.emit("connected");
  }

  private connect(): void {
    if (this.ws?.readyState === WebSocket.OPEN) return;

    try {
      this.ws = new WebSocket(this.wsUrl);

      this.ws.onopen = () => {
        this.isConnected = true;
        this.emit("connected");
        if (this.reconnectTimer) {
          clearTimeout(this.reconnectTimer);
          this.reconnectTimer = null;
        }
      };

      this.ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          this.handleMessage(message);
        } catch (error) {
          console.error("Failed to parse message:", error);
        }
      };

      this.ws.onerror = (error) => {
        console.error("WebSocket error:", error);
        this.emit("error", error);
      };

      this.ws.onclose = () => {
        this.isConnected = false;
        this.emit("disconnected");
        this.scheduleReconnect();
      };
    } catch (error) {
      console.error("Failed to connect:", error);
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 3000);
  }

  private handleMessage(message: SyncMessage): void {
    this.emit("message", message);

    // Emit specific events based on message type
    switch (message.type) {
      case "join":
        this.emit("user-joined", message);
        break;
      case "leave":
        this.emit("user-left", message);
        break;
      case "event":
        this.emit("remote-event", message);
        break;
      case "sync-request":
        this.emit("sync-request", message);
        break;
      case "sync-response":
        this.emit("sync-response", message);
        break;
      case "presence":
        this.emit("presence-update", message);
        break;
    }
  }

  send(message: SyncMessage): void {
    if (this.broadcastChannel) {
      this.broadcastChannel.postMessage(message);
    } else if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    } else {
      console.warn("Cannot send message: not connected");
    }
  }

  getConnectionStatus(): boolean {
    return this.isConnected;
  }

  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    if (this.broadcastChannel) {
      this.broadcastChannel.close();
      this.broadcastChannel = null;
    }

    this.isConnected = false;
    this.emit("disconnected");
  }
}
