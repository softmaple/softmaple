import type { RealtimePeer } from "./types";

/**
 * Process-local peer registry. Redis (or the in-memory bus) carries messages
 * across instances; this hub only fans out to sockets on the current runtime.
 */
export class LocalTopicHub {
  private readonly topics = new Map<string, Set<RealtimePeer>>();

  subscribe(topic: string, peer: RealtimePeer): () => void {
    const peers = this.topics.get(topic) ?? new Set<RealtimePeer>();
    peers.add(peer);
    this.topics.set(topic, peers);
    return () => {
      const current = this.topics.get(topic);
      current?.delete(peer);
      if (current?.size === 0) this.topics.delete(topic);
    };
  }

  publishLocal(topic: string, payload: unknown): void {
    const peers = this.topics.get(topic);
    if (peers === undefined) return;
    for (const peer of peers) {
      peer.send(payload);
    }
  }

  localSubscriberCount(topic: string): number {
    return this.topics.get(topic)?.size ?? 0;
  }

  clear(): void {
    this.topics.clear();
  }
}

export const documentTopicHub = new LocalTopicHub();
export const presenceTopicHub = new LocalTopicHub();
