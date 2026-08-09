import type { RealtimeBus, RealtimeHandler } from "./types";

export class MemoryRealtimeBus implements RealtimeBus {
  private readonly handlers = new Map<string, Set<RealtimeHandler>>();

  async publish(channel: string, payload: unknown): Promise<void> {
    const handlers = [...(this.handlers.get(channel) ?? [])];
    await Promise.all(
      handlers.map(async (handler) => {
        await handler(payload);
      }),
    );
  }

  async subscribe(
    channel: string,
    handler: RealtimeHandler,
  ): Promise<() => Promise<void>> {
    const existing = this.handlers.get(channel) ?? new Set<RealtimeHandler>();
    existing.add(handler);
    this.handlers.set(channel, existing);
    return async () => {
      const current = this.handlers.get(channel);
      current?.delete(handler);
      if (current?.size === 0) this.handlers.delete(channel);
    };
  }

  async close(): Promise<void> {
    this.handlers.clear();
  }
}
