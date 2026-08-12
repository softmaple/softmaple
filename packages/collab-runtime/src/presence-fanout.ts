/** A codec-encoded frame ready for cross-instance delivery. Opaque to the runtime. */
export interface PresenceBroadcast {
  readonly frame: unknown;
  readonly roomId: string;
}

export type PresenceFanoutHandler = (
  broadcast: PresenceBroadcast,
) => void | Promise<void>;

export interface PresenceFanoutSubscription {
  /** Releases this subscription; repeated calls must be safe. */
  unsubscribe(): Promise<void>;
}

/**
 * Cross-room-instance presence broadcast delivery. Distinct from
 * `RoomFanout`: presence never shares a capability instance with the
 * document room. Publish must make the broadcast observable to every
 * matching subscription, including the publisher's own — browser clients
 * rely on that loopback to self-suppress by `senderId`. A subscriber must
 * discard a broadcast whose roomId does not match its subscription.
 */
export interface PresenceFanout {
  publish(broadcast: PresenceBroadcast): Promise<void>;
  subscribe(
    roomId: string,
    handler: PresenceFanoutHandler,
  ): Promise<PresenceFanoutSubscription>;
}
