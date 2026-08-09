import type { RealtimeBus, RealtimeHandler } from "./types";

export class MemoryRealtimeBus implements RealtimeBus {
  private readonly handlers = new Map<string, Set<RealtimeHandler>>();
  private closed = false;

  async publish(channel: string, payload: unknown): Promise<void> {
    if (this.closed) throw new Error("Realtime bus is closed");
    const handlers = [...(this.handlers.get(channel) ?? [])];
    await Promise.all(
      handlers.map(async (handler) => {
        try {
          await handler(payload);
        } catch (error) {
          console.error("Realtime bus handler failed", {
            channel,
            errorName: error instanceof Error ? error.name : "UnknownError",
          });
        }
      }),
    );
  }

  async subscribe(
    channel: string,
    handler: RealtimeHandler,
  ): Promise<() => Promise<void>> {
    if (this.closed) throw new Error("Realtime bus is closed");
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
    this.closed = true;
    this.handlers.clear();
  }
}
