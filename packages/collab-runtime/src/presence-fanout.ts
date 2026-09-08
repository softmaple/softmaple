/** A codec-encoded frame ready for cross-instance delivery. Opaque to the runtime. */
export interface PresenceBroadcast {
  readonly frame: unknown;
  /**
   * When present, the frame is *addressed*: a subscriber delivers it only to
   * local peers whose session id appears here, and to nobody else.
   *
   * This is what keeps an invitation from becoming a broadcast. An invitation
   * carries a passage, sometimes a note, and always the fact that one person
   * asked another to look — none of which belongs to the rest of the room.
   * Absent means the frame is for everyone, which is how presence works.
   */
  readonly recipientSessionIds?: ReadonlyArray<string>;
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
