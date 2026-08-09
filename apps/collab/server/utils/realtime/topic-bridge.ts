import type { LocalTopicHub } from "./local-hub";
import type { RealtimeBus } from "./types";

/**
 * Ref-counted bridge from a distributed RealtimeBus channel onto a local
 * topic hub. The first local subscriber opens the Redis (or memory) channel;
 * the last local unsubscribe closes it.
 */
export class TopicBridge {
  private readonly unsubscribers = new Map<string, () => Promise<void>>();
  private readonly refCounts = new Map<string, number>();

  constructor(
    private readonly bus: RealtimeBus,
    private readonly hub: LocalTopicHub,
  ) {}

  async retain(channel: string): Promise<void> {
    const current = this.refCounts.get(channel) ?? 0;
    this.refCounts.set(channel, current + 1);
    if (current > 0) return;
    const unsubscribe = await this.bus.subscribe(channel, (payload) => {
      this.hub.publishLocal(channel, payload);
    });
    this.unsubscribers.set(channel, unsubscribe);
  }

  async release(channel: string): Promise<void> {
    const current = this.refCounts.get(channel) ?? 0;
    if (current <= 1) {
      this.refCounts.delete(channel);
      const unsubscribe = this.unsubscribers.get(channel);
      this.unsubscribers.delete(channel);
      if (unsubscribe !== undefined) await unsubscribe();
      return;
    }
    this.refCounts.set(channel, current - 1);
  }

  async close(): Promise<void> {
    const pending = [...this.unsubscribers.values()].map((unsubscribe) =>
      unsubscribe(),
    );
    this.unsubscribers.clear();
    this.refCounts.clear();
    await Promise.all(pending);
  }
}
