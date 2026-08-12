import {
  createPresenceRoom,
  DEFAULT_PRESENCE_ROOM_POLICY,
  ROOM_LEAVE_REASON,
  type PresencePeer,
  type PresencePeerSnapshot,
  type PresenceRoom,
  type PresenceRoomServices,
  type RoomLeaveReason,
} from "@softmaple/collab-runtime";
import { randomUUID } from "node:crypto";
import { awarenessPresenceCodec } from "./awareness-presence-codec";
import { presenceSessionHooks } from "./presence-session-hooks";
import { realtimePresenceConnectionLimiter } from "./realtime-presence-connection-limiter";
import { realtimePresenceFanout } from "./realtime-presence-fanout";
import { realtimePresenceStore } from "./realtime-presence-store";

export const MAX_PRESENCE_MESSAGE_BYTES = 64 * 1024;
const PRESENCE_HOST_CONTEXT_KEY = "presenceRuntimeHost";

export interface NitroPresenceTransportPeer {
  readonly context: Record<string, unknown>;
  readonly id?: string;
  close(code: number, reason: string): void;
  send(message: unknown): unknown;
}

const logHostError = (
  error: unknown,
  roomId: string | null,
  messageType: string,
): void => {
  console.error("Presence request failed", {
    roomId,
    messageType,
    errorName: error instanceof Error ? error.name : "UnknownError",
    errorMessage: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });
};

const roomServices: PresenceRoomServices = {
  codec: awarenessPresenceCodec,
  connections: realtimePresenceConnectionLimiter,
  fanout: realtimePresenceFanout,
  policy: DEFAULT_PRESENCE_ROOM_POLICY,
  reportError(error, context) {
    logHostError(error, context.roomId, context.messageType ?? "unknown");
  },
  sessions: presenceSessionHooks,
  store: realtimePresenceStore,
};

class NitroPresencePeer implements PresencePeer {
  readonly id: string;
  private closeRequested = false;

  constructor(private readonly transport: NitroPresenceTransportPeer) {
    this.id =
      typeof transport.id === "string" && transport.id.length > 0
        ? transport.id
        : randomUUID();
  }

  get closed(): boolean {
    return this.closeRequested;
  }

  close(code: number, reason: string): void {
    if (this.closeRequested) return;
    this.closeRequested = true;
    this.transport.close(code, reason);
  }

  markTransportClosed(): void {
    this.closeRequested = true;
  }

  send(frame: unknown): void {
    if (this.closeRequested) return;
    this.transport.send(frame);
  }

  persist(snapshot: PresencePeerSnapshot): void {
    this.transport.context.presenceSnapshot = snapshot;
  }
}

interface RoomEntry {
  readonly peers: Set<NitroPresencePeer>;
  readonly room: PresenceRoom;
}

interface RoomBinding {
  readonly roomId: string;
  readonly room: PresenceRoom;
  release(reason?: RoomLeaveReason): Promise<void>;
}

const rooms = new Map<string, RoomEntry>();

const closeRoomEntry = async (
  roomId: string,
  entry: RoomEntry,
): Promise<void> => {
  if (rooms.get(roomId) !== entry || entry.peers.size > 0) return;
  rooms.delete(roomId);
  try {
    await entry.room.close();
  } catch (error) {
    logHostError(error, roomId, "room-close");
  }
};

const acquireRoom = async (
  roomId: string,
  peer: NitroPresencePeer,
): Promise<RoomBinding> => {
  const entry =
    rooms.get(roomId) ??
    (() => {
      const created: RoomEntry = {
        peers: new Set<NitroPresencePeer>(),
        room: createPresenceRoom(roomId, roomServices),
      };
      rooms.set(roomId, created);
      return created;
    })();
  entry.peers.add(peer);
  try {
    await entry.room.join(peer);
  } catch (error) {
    entry.peers.delete(peer);
    await closeRoomEntry(roomId, entry);
    throw error;
  }

  let released = false;
  return {
    roomId,
    room: entry.room,
    async release(reason = ROOM_LEAVE_REASON.ConnectionClosed) {
      if (released) return;
      released = true;
      try {
        await entry.room.leave(peer, reason);
      } catch (error) {
        logHostError(error, roomId, "room-leave");
      } finally {
        entry.peers.delete(peer);
        await closeRoomEntry(roomId, entry);
      }
    },
  };
};

/** Per-socket ingress and room binding around a Nitro/crossws presence peer. */
export class NitroPresenceHost {
  private readonly peer: NitroPresencePeer;
  private binding: RoomBinding | null = null;
  private closed = false;

  constructor(
    transport: NitroPresenceTransportPeer,
    private readonly roomId: string,
  ) {
    this.peer = new NitroPresencePeer(transport);
  }

  async receiveText(rawText: string): Promise<void> {
    if (this.closed || this.peer.closed) return;
    if (Buffer.byteLength(rawText, "utf8") > MAX_PRESENCE_MESSAGE_BYTES) {
      this.peer.close(1009, "Presence frame is too large");
      await this.release();
      return;
    }

    try {
      await this.ensureRoom();
    } catch (error) {
      logHostError(error, this.roomId, "room-acquire");
      return;
    }
    if (this.binding === null || this.peer.closed) {
      await this.release();
      return;
    }

    await this.binding.room.receive(this.peer, rawText);
    if (this.peer.closed) await this.release();
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.peer.markTransportClosed();
    await this.release();
  }

  private async ensureRoom(): Promise<void> {
    if (this.binding !== null) return;
    this.binding = await acquireRoom(this.roomId, this.peer);
  }

  private async release(): Promise<void> {
    const binding = this.binding;
    this.binding = null;
    await binding?.release();
  }
}

const hostFromContext = (
  context: Record<string, unknown>,
): NitroPresenceHost | null => {
  const value = context[PRESENCE_HOST_CONTEXT_KEY];
  return value instanceof NitroPresenceHost ? value : null;
};

export const getNitroPresenceHost = (
  peer: NitroPresenceTransportPeer,
  roomId: string,
): NitroPresenceHost => {
  const existing = hostFromContext(peer.context);
  if (existing !== null) return existing;
  const host = new NitroPresenceHost(peer, roomId);
  peer.context[PRESENCE_HOST_CONTEXT_KEY] = host;
  return host;
};

export const closeNitroPresenceHost = async (
  peer: NitroPresenceTransportPeer,
): Promise<void> => {
  const host = hostFromContext(peer.context);
  delete peer.context[PRESENCE_HOST_CONTEXT_KEY];
  await host?.close();
};
