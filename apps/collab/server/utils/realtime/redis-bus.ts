import Redis from "ioredis";
import type { RealtimeBus, RealtimeHandler } from "./types";

const encodePayload = (payload: unknown): string => JSON.stringify(payload);

const decodePayload = (raw: string): unknown => {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
};

/**
 * Redis Pub/Sub bus with publisher/subscriber connection reuse and per-channel
 * local reference counting. Duplicate deliveries are tolerated by callers.
 */
export class RedisRealtimeBus implements RealtimeBus {
  private readonly publisher: Redis;
  private readonly subscriber: Redis;
  private readonly handlers = new Map<string, Set<RealtimeHandler>>();
  private readonly pendingSubscribe = new Map<string, Promise<void>>();
  private closed = false;

  constructor(redisUrl: string) {
    this.publisher = new Redis(redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
      lazyConnect: false,
    });
    this.subscriber = new Redis(redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
      lazyConnect: false,
    });
    this.subscriber.on("message", (channel, message) => {
      void this.dispatch(channel, message);
    });
  }

  private async dispatch(channel: string, message: string): Promise<void> {
    const handlers = [...(this.handlers.get(channel) ?? [])];
    if (handlers.length === 0) return;
    const payload = decodePayload(message);
    if (payload === null) return;
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

  async publish(channel: string, payload: unknown): Promise<void> {
    if (this.closed) throw new Error("Realtime bus is closed");
    await this.publisher.publish(channel, encodePayload(payload));
  }

  async subscribe(
    channel: string,
    handler: RealtimeHandler,
  ): Promise<() => Promise<void>> {
    if (this.closed) throw new Error("Realtime bus is closed");
    const existing = this.handlers.get(channel) ?? new Set<RealtimeHandler>();
    const shouldSubscribe = existing.size === 0;
    existing.add(handler);
    this.handlers.set(channel, existing);

    if (shouldSubscribe) {
      const pending =
        this.pendingSubscribe.get(channel) ??
        this.subscriber.subscribe(channel).then(() => undefined);
      this.pendingSubscribe.set(channel, pending);
      try {
        await pending;
      } finally {
        this.pendingSubscribe.delete(channel);
      }
    }

    return async () => {
      const current = this.handlers.get(channel);
      if (current === undefined) return;
      current.delete(handler);
      if (current.size > 0) return;
      this.handlers.delete(channel);
      if (this.closed) return;
      try {
        await this.subscriber.unsubscribe(channel);
      } catch (error) {
        console.error("Realtime bus unsubscribe failed", {
          channel,
          errorName: error instanceof Error ? error.name : "UnknownError",
        });
      }
    };
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.handlers.clear();
    this.pendingSubscribe.clear();
    this.subscriber.removeAllListeners("message");
    await Promise.all([
      this.publisher.quit().catch(() => undefined),
      this.subscriber.quit().catch(() => undefined),
    ]);
  }
}
