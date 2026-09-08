# Shared attention

Deliberate shared attention, and a reliable return to independent work.

This document is the contract. It covers identity, state, invitations, follow
relationships, delivery guarantees, privacy, and what happens when an older
client is in the room. The types live in
[`packages/awareness/src/attention`](../../packages/awareness/src/attention)
and are exported as `@softmaple/awareness/attention`.

## Why the semantics live in the awareness package

Three layers, and the boundary between them is load-bearing:

| Layer | Owns | Where |
| --- | --- | --- |
| Semantics | What people say to each other | `packages/awareness/src/attention` |
| Transport | How it is framed and fanned out | `packages/collab-runtime`, both hosts |
| Geometry | Where it lands on screen | `packages/binding-lexical`, `apps/web` |

Keeping semantics transport-independent is what lets Nitro and Cloudflare share
one definition of "following", and lets the editor decide how a caret is drawn
without having a say in what a caret *means*.

## Identity

```
userId     the account          shared by all of a person's tabs
sessionId  one tab              survives reconnects
connectionId  one socket        changes on every reconnect
```

`connectionId` is unusable as the target of a follow: a two-second network blip
would change it, and the relationship would end without anyone deciding to end
it. `sessionId` is minted once per tab and kept across reconnects, so "follow
that person's other window" keeps meaning the same window.

The roster groups sessions by `userId`, so one person with three tabs is one
person. Attention is always addressed to a `sessionId`, because "look here" has
to arrive somewhere specific.

## State versus commands

The split is the single most important decision in this design.

**State** (`AttentionState`) is coalescible. Only the latest value matters, and
dropping an intermediate one loses nothing:

- `foreground` — is this tab in front of the person
- `activity` — editing, viewing, or idle, from that session's own signals
- `location` — a `SemanticLocation`, coarser than a caret on purpose
- `presenting` — this session has opted into being followed
- `followingSessionId` — who this session is currently following

**Commands** (`AttentionCommand`) are deliberate acts and must not be coalesced.
Dropping one loses something a person did:

`attention:invite`, `attention:cancel`, `attention:accept`,
`attention:dismiss`, `follow:start`, `follow:stop`.

Sending a command down the state channel would let a busy room quietly discard
an invitation. Sending state down the command channel would flood it. They are
separate for that reason and must stay separate.

## Semantic location

A section, not a caret:

```ts
type SemanticLocation = {
  sectionId: string | null;   // heading block, null for the opening section
  sectionIndex: number;       // for resolving a deleted section by position
  title: string;              // as it read when captured
};
```

A section survives edits that invalidate an exact position, it is what a person
can actually read ("in Method"), and it is the only thing a return journey can
resolve to when the block somebody left has been deleted.

Content before the first heading is its own section rather than being dropped,
so every block belongs somewhere. See
[`apps/web/modules/docs/document-sections.ts`](../../apps/web/modules/docs/document-sections.ts).

## Invitations

An invitation is short-lived, addressed, and answered exactly once.

- **Addressed, not broadcast.** `recipientSessionIds` is non-empty and capped
  at 50. A recipient refuses one it is not named in.
- **Expiring.** 30 seconds (`ATTENTION_INVITATION_TTL_MS`). Expiry is checked
  against a `now` passed in, never against a timer, so it is testable and
  cannot drift with a slow event loop.
- **Never replayed.** An invitation that had already expired when it arrives is
  refused with `expired`. This is what stops a reconnect from resurrecting a
  gesture somebody made a minute ago.
- **Deduplicated.** Every command carries an `id`; the receiver remembers the
  last 256 and refuses a repeat with `duplicate`. A resend of the *same*
  invitation id replaces rather than stacks: the sender meant one invitation,
  however many times it arrived.
- **One at a time.** Only the newest live invitation is surfaced. A stack of
  invitations is a queue of interruptions.

### What an invitation must never do

Arrival never moves focus, selection, viewport, or the mobile keyboard. An
invitation is an offer; acting on it is a separate, deliberate act by the
recipient. This is not a UI preference — a "look here" that steals the caret
mid-sentence corrupts what somebody was writing.

## Following

```
independent ──start──▶ following ──suspend──▶ suspended ──resume──▶ following
                           │                      │
                           └──────── stop/end ────┴──▶ ended
```

`applyFollowEvent` is pure and total: every state answers every event, so an
event arriving out of order changes nothing rather than corrupting the
relationship.

**Presenter opt-in.** Nobody can be followed without setting `presenting`.
Being watched is a decision, not a side effect of being active.

**What suspends.** Deliberate local acts: scrolling, editing, navigating,
asking to edit at the shared location, and losing the connection. Pointer
movement does not — suspending on it would make following unusable on any
machine with a mouse.

**What ends, and why.** `stopped`, `presenter-left`,
`presenter-stopped-presenting`, `access-revoked`, `sharing-disabled`,
`left-document`. Every ending names its reason, because "following just
stopped" is not something a person can act on.

**Resuming is always deliberate.** A suspended relationship resumes only on an
explicit Resume — including after a reconnect. An *ended* relationship never
revives: doing so would move somebody's viewport without anyone asking.

**Cycles are refused.** A follows B follows A is two viewports chasing each
other. `wouldCycle` walks the existing relationships from the intended
presenter and refuses if it arrives back at the follower. It terminates on
loops that do not include the follower, too.

**The return anchor** is captured when following starts and survives suspension
and ending. Re-targeting to a different presenter keeps the *original* anchor:
the place you were before any of this began is the one worth going back to.
Resolution order when returning is the section the block was in, then the
remembered section index clamped to a shortened document, then the start of the
document — and never an invented position in an empty document.

## Delivery outcomes

A command is never silently swallowed. The sender learns either
`{ status: "delivered", deliveredToSessionIds }` or
`{ status: "refused", reason }`, where the reason is one of `duplicate`,
`expired`, `unknown`, `not-addressed`, `no-such-session`, `not-presenting`,
`cycle`, `forbidden`, `rate-limited`.

"Delivered to nobody" is a real and useful answer: it means every addressee had
already closed the tab.

## Privacy

- **Location is opt-in.** The detailed-location preference is per device. Off
  means collaborators still see that the person is here and active — presence
  is not hidden, only precision is withheld.
- **Focus mode is not invisibility.** It quiets *incoming* chrome. Collaborators
  still see this session, its caret and its activity exactly as before.
  Anything else would be a lie to the room.
- **A background tab withdraws its position.** Precise location stops being
  published when the tab is hidden, and the last position is withdrawn rather
  than left behind to go stale. Membership is unaffected: the person has not
  left, they have looked away.
- **Presenting is never implicit.** No amount of activity makes a session
  followable.

## Compatibility

Version 3 is additive over version 2.

| | v2 client | v3 client |
| --- | --- | --- |
| Presence, cursors, selections | yes | yes |
| Attention state | no | yes |
| Invitations, following | no | yes |

`negotiate` intersects capability sets — never unions them — so a richer frame
only ever reaches a peer that said it understands one. A v2 client says nothing
about attention, and that silence is a complete answer rather than an error. A
v3 client in a room that does not support attention falls back to plain
presence; it does not degrade or fail.

Unknown capability names from a newer peer are ignored rather than rejected, so
a version 4 can add one without breaking this build.

## Wire validation

Every frame is validated at the boundary
([`wire.ts`](../../packages/awareness/src/attention/wire.ts)). Attention
commands move other people's viewports, so a malformed or hostile frame is
rejected on arrival rather than reasoned about later, and each parser throws
naming the field that failed. Bounded strings (a 140-character note, a
200-character section title) are truncated rather than rejected, because a long
title should not cost somebody their invitation.

## Status

Implemented and tested:

- All contracts above, in `packages/awareness/src/attention`.
- The follow state machine, invitation registry, capability negotiation and
  wire parsers, with tests covering expiry, duplicate and out-of-order
  delivery, cycles, and version-2 fallback.
- Section-relative location and the People and activity view in `apps/web`.

Not yet implemented:

- **Server fan-out.** Attention commands are not yet carried by the presence
  rooms in `packages/collab-runtime`, nor by the Nitro and Cloudflare codecs.
  Until they are, the `sharedAttention` feature flag defaults to off: a "Look
  here" that never reaches a colleague is worse than no button.
- The shared-context projection pane, "Edit here" transfer, and the mobile
  preview sheet, which depend on that transport.
