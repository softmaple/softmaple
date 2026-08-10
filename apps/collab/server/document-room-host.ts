import {
  DEFAULT_DOCUMENT_ROOM_POLICY,
  ROOM_LEAVE_REASON,
  createDocumentRoom,
  type DocumentRoom,
  type RoomPeer,
} from "@softmaple/collab-runtime";
import {
  COLLAB_ERROR_CODE,
  COLLAB_MESSAGE_TYPE,
  COLLAB_PROTOCOL_VERSION,
  type ClientCollabMessage,
  type SupportedCollabProtocolVersion,
} from "@softmaple/collab-protocol";
import { documentSessionHooks } from "./adapters/document-session-hooks";
import { prismaDocumentEventStore } from "./adapters/prisma-document-event-store";
import { createRealtimeConnectionLimiter } from "./adapters/realtime-connection-limiter";
import { createRedisRoomFanout } from "./adapters/redis-room-fanout";

interface RoomEntry {
  readonly peers: Set<RoomPeer>;
  readonly room: DocumentRoom;
}

interface PeerBinding {
  readonly entry: RoomEntry;
  protocolVersion: SupportedCollabProtocolVersion;
}

const sendBeforeAuthenticationError = async (peer: RoomPeer): Promise<void> => {
  try {
    await peer.send({
      protocolVersion: COLLAB_PROTOCOL_VERSION,
      type: COLLAB_MESSAGE_TYPE.Error,
      code: COLLAB_ERROR_CODE.AuthenticationFailed,
      message: "Authenticate before sending collaboration messages",
      retryable: false,
    });
  } catch {
    // The transport may have closed before the host could reject the message.
  }
};

export class DocumentRoomHost {
  private readonly bindings = new WeakMap<RoomPeer, PeerBinding>();
  private readonly rooms = new Map<string, RoomEntry>();
  private readonly terminalPeers = new WeakSet<RoomPeer>();
  private closed = false;

  private createRoom(documentId: string): RoomEntry {
    const room = createDocumentRoom(documentId, {
      connections: createRealtimeConnectionLimiter(),
      events: prismaDocumentEventStore,
      fanout: createRedisRoomFanout(),
      policy: DEFAULT_DOCUMENT_ROOM_POLICY,
      sessions: documentSessionHooks,
    });
    return { peers: new Set(), room };
  }

  async receive(peer: RoomPeer, message: ClientCollabMessage): Promise<void> {
    if (this.closed || this.terminalPeers.has(peer)) return;
    let binding = this.bindings.get(peer);

    if (binding === undefined) {
      if (message.type !== COLLAB_MESSAGE_TYPE.Auth) {
        await sendBeforeAuthenticationError(peer);
        return;
      }
      const entry =
        this.rooms.get(message.documentId) ??
        this.createAndRegisterRoom(message.documentId);
      binding = {
        entry,
        protocolVersion: message.protocolVersion,
      };
      this.bindings.set(peer, binding);
      entry.peers.add(peer);
      try {
        await entry.room.join(peer);
      } catch (error) {
        this.bindings.delete(peer);
        entry.peers.delete(peer);
        if (entry.peers.size === 0) {
          this.rooms.delete(entry.room.documentId);
          await entry.room.close().catch(() => undefined);
        }
        throw error;
      }
      if (this.closed || this.terminalPeers.has(peer)) return;
    } else if (message.type === COLLAB_MESSAGE_TYPE.Auth) {
      binding.protocolVersion = message.protocolVersion;
    }

    await binding.entry.room.receive(peer, message);
  }

  protocolVersionFor(peer: RoomPeer): SupportedCollabProtocolVersion {
    return this.bindings.get(peer)?.protocolVersion ?? COLLAB_PROTOCOL_VERSION;
  }

  documentIdFor(peer: RoomPeer): string | null {
    return this.bindings.get(peer)?.entry.room.documentId ?? null;
  }

  async leave(peer: RoomPeer): Promise<void> {
    this.terminalPeers.add(peer);
    const binding = this.bindings.get(peer);
    this.bindings.delete(peer);
    if (binding === undefined) return;

    const { entry } = binding;
    entry.peers.delete(peer);
    const idle = entry.peers.size === 0;
    if (idle) this.rooms.delete(entry.room.documentId);

    await entry.room.leave(peer, ROOM_LEAVE_REASON.ConnectionClosed);
    if (idle) await entry.room.close();
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    const entries = [...this.rooms.values()];
    this.rooms.clear();
    await Promise.all(entries.map(({ room }) => room.close()));
  }

  private createAndRegisterRoom(documentId: string): RoomEntry {
    const entry = this.createRoom(documentId);
    this.rooms.set(documentId, entry);
    return entry;
  }
}

let documentRoomHost: DocumentRoomHost | null = null;

export const getDocumentRoomHost = (): DocumentRoomHost => {
  if (documentRoomHost === null) documentRoomHost = new DocumentRoomHost();
  return documentRoomHost;
};

export const closeDocumentRoomHost = async (): Promise<void> => {
  const host = documentRoomHost;
  await host?.close();
  if (documentRoomHost === host) documentRoomHost = null;
};

export const resetDocumentRoomHostForTests = closeDocumentRoomHost;
