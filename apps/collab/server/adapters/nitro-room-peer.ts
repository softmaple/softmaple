import type { RoomPeer } from "@softmaple/collab-runtime";
import { randomUUID } from "node:crypto";

export interface NitroPeerLike {
  close(code: number, reason: string): unknown;
  send(message: unknown): unknown;
}

const roomPeers = new WeakMap<NitroPeerLike, RoomPeer>();

export const toNitroRoomPeer = (peer: NitroPeerLike): RoomPeer => {
  const existing = roomPeers.get(peer);
  if (existing !== undefined) return existing;

  const adapted: RoomPeer = {
    id: randomUUID(),
    async close(code, reason) {
      await peer.close(code, reason);
    },
    async send(message) {
      await peer.send(message);
    },
  };
  roomPeers.set(peer, adapted);
  return adapted;
};
