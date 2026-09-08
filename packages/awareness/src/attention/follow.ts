/**
 * The follow relationship, as a state machine.
 *
 * Following somebody is a loan of your viewport, and the interesting part is
 * all the ways it has to end or pause without losing your own place. Every
 * transition here is named, every ending says why, and nothing recovers
 * silently: after a break, resuming is always a deliberate act.
 */

export const FOLLOW_STATE = {
  /** Not following anybody. The normal state. */
  Independent: "independent",
  /** Viewport is tracking the presenter. */
  Following: "following",
  /**
   * Still bound to the presenter, but not moving with them, because the
   * follower did something of their own.
   */
  Suspended: "suspended",
  /** The relationship is over, and the reason is worth showing. */
  Ended: "ended",
} as const;

export type FollowState = (typeof FOLLOW_STATE)[keyof typeof FOLLOW_STATE];

export const FOLLOW_END_REASON = {
  /** The follower chose to stop. */
  Stopped: "stopped",
  /** The presenter left the document. */
  PresenterLeft: "presenter-left",
  /** The presenter turned presenting off. */
  PresenterStoppedPresenting: "presenter-stopped-presenting",
  /** The follower lost access to the document. */
  AccessRevoked: "access-revoked",
  /** Public sharing was switched off. */
  SharingDisabled: "sharing-disabled",
  /** The follower navigated away from the document. */
  LeftDocument: "left-document",
} as const;

export type FollowEndReason =
  (typeof FOLLOW_END_REASON)[keyof typeof FOLLOW_END_REASON];

export const FOLLOW_SUSPEND_REASON = {
  /** The follower scrolled deliberately. */
  Scrolled: "scrolled",
  /** The follower typed. */
  Edited: "edited",
  /** The follower moved their caret or selected something. */
  Navigated: "navigated",
  /** The connection dropped; resuming needs a deliberate act. */
  Disconnected: "disconnected",
  /** The follower asked to edit at the shared location. */
  EditingHere: "editing-here",
} as const;

export type FollowSuspendReason =
  (typeof FOLLOW_SUSPEND_REASON)[keyof typeof FOLLOW_SUSPEND_REASON];

/** Where the follower was before they started following. */
export type ReturnAnchor = {
  readonly blockId: string | null;
  readonly sectionId: string | null;
  readonly sectionIndex: number;
};

export type FollowSession =
  | { readonly state: typeof FOLLOW_STATE.Independent }
  | {
      readonly state: typeof FOLLOW_STATE.Following;
      readonly presenterSessionId: string;
      readonly returnAnchor: ReturnAnchor | null;
    }
  | {
      readonly state: typeof FOLLOW_STATE.Suspended;
      readonly presenterSessionId: string;
      readonly reason: FollowSuspendReason;
      readonly returnAnchor: ReturnAnchor | null;
    }
  | {
      readonly state: typeof FOLLOW_STATE.Ended;
      readonly presenterSessionId: string;
      readonly reason: FollowEndReason;
      readonly returnAnchor: ReturnAnchor | null;
    };

export const INDEPENDENT: FollowSession = Object.freeze({
  state: FOLLOW_STATE.Independent,
});

export const FOLLOW_EVENT = {
  Start: "start",
  Suspend: "suspend",
  Resume: "resume",
  Stop: "stop",
  End: "end",
  /** Pointer movement and other incidental input. Never suspends. */
  Incidental: "incidental",
} as const;

export type FollowEvent =
  | {
      readonly type: typeof FOLLOW_EVENT.Start;
      readonly presenterSessionId: string;
      readonly returnAnchor: ReturnAnchor | null;
    }
  | {
      readonly type: typeof FOLLOW_EVENT.Suspend;
      readonly reason: FollowSuspendReason;
    }
  | { readonly type: typeof FOLLOW_EVENT.Resume }
  | { readonly type: typeof FOLLOW_EVENT.Stop }
  | { readonly type: typeof FOLLOW_EVENT.End; readonly reason: FollowEndReason }
  | { readonly type: typeof FOLLOW_EVENT.Incidental };

/**
 * Apply one event.
 *
 * Pure and total: every state answers every event, so an event arriving in an
 * unexpected order changes nothing rather than corrupting the relationship.
 */
export const applyFollowEvent = (
  session: FollowSession,
  event: FollowEvent,
): FollowSession => {
  switch (event.type) {
    case FOLLOW_EVENT.Start:
      // Starting again while already bound re-targets, keeping the *original*
      // return anchor: the place you were before any of this began is the one
      // worth going back to.
      return Object.freeze({
        state: FOLLOW_STATE.Following,
        presenterSessionId: event.presenterSessionId,
        returnAnchor:
          session.state === FOLLOW_STATE.Independent
            ? event.returnAnchor
            : (session.returnAnchor ?? event.returnAnchor),
      });

    case FOLLOW_EVENT.Suspend:
      if (session.state !== FOLLOW_STATE.Following) return session;
      return Object.freeze({
        state: FOLLOW_STATE.Suspended,
        presenterSessionId: session.presenterSessionId,
        reason: event.reason,
        returnAnchor: session.returnAnchor,
      });

    case FOLLOW_EVENT.Resume:
      // Only a suspended relationship can resume. An ended one is over, and
      // reviving it silently would move somebody's viewport without consent.
      if (session.state !== FOLLOW_STATE.Suspended) return session;
      return Object.freeze({
        state: FOLLOW_STATE.Following,
        presenterSessionId: session.presenterSessionId,
        returnAnchor: session.returnAnchor,
      });

    case FOLLOW_EVENT.Stop:
      if (session.state === FOLLOW_STATE.Independent) return session;
      if (session.state === FOLLOW_STATE.Ended) return session;
      return Object.freeze({
        state: FOLLOW_STATE.Ended,
        presenterSessionId: session.presenterSessionId,
        reason: FOLLOW_END_REASON.Stopped,
        returnAnchor: session.returnAnchor,
      });

    case FOLLOW_EVENT.End:
      if (session.state === FOLLOW_STATE.Independent) return session;
      if (session.state === FOLLOW_STATE.Ended) return session;
      return Object.freeze({
        state: FOLLOW_STATE.Ended,
        presenterSessionId: session.presenterSessionId,
        reason: event.reason,
        returnAnchor: session.returnAnchor,
      });

    case FOLLOW_EVENT.Incidental:
      // Moving a pointer is not a decision. Suspending on it would make
      // following unusable on any machine with a mouse.
      return session;

    default:
      return session;
  }
};

/** Whether the viewport should currently track the presenter. */
export const isTrackingPresenter = (session: FollowSession): boolean =>
  session.state === FOLLOW_STATE.Following;

/** The place to go back to, once the relationship is over or paused. */
export const returnAnchorOf = (session: FollowSession): ReturnAnchor | null =>
  session.state === FOLLOW_STATE.Independent ? null : session.returnAnchor;

/**
 * Would starting this follow create a cycle?
 *
 * A follows B follows A means two viewports chasing each other forever. The
 * check walks the existing relationships from the intended presenter; if it
 * arrives back at the follower, the request is refused.
 */
export const wouldCycle = (
  followerSessionId: string,
  presenterSessionId: string,
  /** Who each session is currently following. */
  followingBySession: ReadonlyMap<string, string>,
): boolean => {
  if (followerSessionId === presenterSessionId) return true;
  const seen = new Set<string>([followerSessionId]);
  let current: string | undefined = presenterSessionId;
  while (current !== undefined) {
    if (seen.has(current)) return true;
    seen.add(current);
    current = followingBySession.get(current);
  }
  return false;
};
