import type { RoomPeer } from "@softmaple/collab-runtime";
import { randomUUID } from "node:crypto";

export interface NitroPeerLike {
  close(code: number, reason: string): void | Promise<void>;
  send(message: unknown): void | Promise<void>;
}

const roomPeers = new WeakMap<NitroPeerLike, RoomPeer>();

export const toNitroRoomPeer = (peer: NitroPeerLike): RoomPeer => {
  const existing = roomPeers.get(peer);
  if (existing !== undefined) return existing;

  const adapted: RoomPeer = {
    id: randomUUID(),
    close: (code, reason) => peer.close(code, reason),
    send: (message) => peer.send(message),
  };
  roomPeers.set(peer, adapted);
  return adapted;
};
