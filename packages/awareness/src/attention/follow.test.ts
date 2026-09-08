import { describe, expect, it } from "vitest";
import {
  applyFollowEvent,
  FOLLOW_END_REASON,
  FOLLOW_EVENT,
  FOLLOW_STATE,
  FOLLOW_SUSPEND_REASON,
  type FollowSession,
  INDEPENDENT,
  isTrackingPresenter,
  returnAnchorOf,
  wouldCycle,
} from "./follow";

const anchor = { blockId: "b1", sectionId: "h1", sectionIndex: 2 };

const following = (): FollowSession =>
  applyFollowEvent(INDEPENDENT, {
    type: FOLLOW_EVENT.Start,
    presenterSessionId: "presenter",
    returnAnchor: anchor,
  });

describe("applyFollowEvent", () => {
  it("starts from independent and tracks the presenter", () => {
    const session = following();
    expect(session.state).toBe(FOLLOW_STATE.Following);
    expect(isTrackingPresenter(session)).toBe(true);
    expect(returnAnchorOf(session)).toEqual(anchor);
  });

  it("suspends on a deliberate act and stops tracking", () => {
    const session = applyFollowEvent(following(), {
      type: FOLLOW_EVENT.Suspend,
      reason: FOLLOW_SUSPEND_REASON.Scrolled,
    });
    expect(session.state).toBe(FOLLOW_STATE.Suspended);
    expect(isTrackingPresenter(session)).toBe(false);
  });

  it("never suspends on incidental input such as pointer movement", () => {
    const session = following();
    expect(applyFollowEvent(session, { type: FOLLOW_EVENT.Incidental })).toBe(
      session,
    );
  });

  it("resumes only from suspended, and only deliberately", () => {
    const suspended = applyFollowEvent(following(), {
      type: FOLLOW_EVENT.Suspend,
      reason: FOLLOW_SUSPEND_REASON.Disconnected,
    });
    expect(
      applyFollowEvent(suspended, { type: FOLLOW_EVENT.Resume }).state,
    ).toBe(FOLLOW_STATE.Following);

    const ended = applyFollowEvent(following(), {
      type: FOLLOW_EVENT.End,
      reason: FOLLOW_END_REASON.PresenterLeft,
    });
    // An ended relationship must not revive: that would move a viewport
    // without anyone asking for it.
    expect(applyFollowEvent(ended, { type: FOLLOW_EVENT.Resume })).toBe(ended);
  });

  it("keeps the return anchor through suspension and ending", () => {
    const suspended = applyFollowEvent(following(), {
      type: FOLLOW_EVENT.Suspend,
      reason: FOLLOW_SUSPEND_REASON.Edited,
    });
    const ended = applyFollowEvent(suspended, { type: FOLLOW_EVENT.Stop });
    expect(returnAnchorOf(suspended)).toEqual(anchor);
    expect(returnAnchorOf(ended)).toEqual(anchor);
  });

  it("keeps the original return anchor when re-targeting", () => {
    const retargeted = applyFollowEvent(following(), {
      type: FOLLOW_EVENT.Start,
      presenterSessionId: "someone-else",
      returnAnchor: { blockId: "later", sectionId: null, sectionIndex: 9 },
    });
    expect(retargeted.state).toBe(FOLLOW_STATE.Following);
    expect(returnAnchorOf(retargeted)).toEqual(anchor);
  });

  it("names why the relationship ended", () => {
    for (const reason of Object.values(FOLLOW_END_REASON)) {
      const ended = applyFollowEvent(following(), {
        type: FOLLOW_EVENT.End,
        reason,
      });
      expect(ended).toMatchObject({ state: FOLLOW_STATE.Ended, reason });
    }
  });

  it("answers every event from every state without corrupting itself", () => {
    const states: ReadonlyArray<FollowSession> = [
      INDEPENDENT,
      following(),
      applyFollowEvent(following(), {
        type: FOLLOW_EVENT.Suspend,
        reason: FOLLOW_SUSPEND_REASON.Navigated,
      }),
      applyFollowEvent(following(), { type: FOLLOW_EVENT.Stop }),
    ];
    const events = [
      { type: FOLLOW_EVENT.Resume },
      { type: FOLLOW_EVENT.Stop },
      { type: FOLLOW_EVENT.Incidental },
      { type: FOLLOW_EVENT.Suspend, reason: FOLLOW_SUSPEND_REASON.Scrolled },
      { type: FOLLOW_EVENT.End, reason: FOLLOW_END_REASON.AccessRevoked },
    ] as const;
    for (const state of states) {
      for (const event of events) {
        expect(Object.values(FOLLOW_STATE)).toContain(
          applyFollowEvent(state, event).state,
        );
      }
    }
  });

  it("does nothing when an ending arrives for an independent session", () => {
    expect(
      applyFollowEvent(INDEPENDENT, {
        type: FOLLOW_EVENT.End,
        reason: FOLLOW_END_REASON.SharingDisabled,
      }),
    ).toBe(INDEPENDENT);
  });
});

describe("wouldCycle", () => {
  it("refuses following yourself", () => {
    expect(wouldCycle("a", "a", new Map())).toBe(true);
  });

  it("refuses a direct loop", () => {
    expect(wouldCycle("a", "b", new Map([["b", "a"]]))).toBe(true);
  });

  it("refuses a longer loop", () => {
    expect(
      wouldCycle(
        "a",
        "b",
        new Map([
          ["b", "c"],
          ["c", "a"],
        ]),
      ),
    ).toBe(true);
  });

  it("allows a chain that does not come back", () => {
    expect(
      wouldCycle(
        "a",
        "b",
        new Map([
          ["b", "c"],
          ["c", "d"],
        ]),
      ),
    ).toBe(false);
  });

  it("terminates on a loop that does not include the follower", () => {
    expect(
      wouldCycle(
        "a",
        "b",
        new Map([
          ["b", "c"],
          ["c", "b"],
        ]),
      ),
    ).toBe(true);
  });
});
