# Shared attention contracts

## Product and access boundary

Presence and live editing continue to require an enabled public link. Workspace
membership controls owner/editor/viewer capabilities. An anonymous public reader
gets a read-only document and never joins authenticated presence. No production
content schema changes, comments, inbox, mentions, reactions, or access requests
are introduced.

Durable document operations remain in the document runtime. Presence metadata,
attention receipts and follow relationships are disposable room state. The home
summary endpoint independently authorizes each requested public-link document;
it does not join rooms to obtain counts. Missing or failed summaries mean
“unavailable”, not zero people.

## Identity and compatibility

Protocol version 2 and its existing required capabilities remain unchanged. A
client can additionally send `extensions: { sharedAttention: 1, sessionId }`.
The client identifier survives adapter reconnects in the mounted document
session. The host namespaces it with the authenticated account ID and keeps it
separate from the connection ID and connection clock. Oversized combined IDs
fall back to basic presence. Follow binds to a session and records its current
connection; it does not follow every tab belonging to one person.

Old clients receive basic v2 membership and cursor frames. The shared host codec
filters extension frames and collaboration metadata per negotiated capability.
Invitation anchors and recipient lists are visible only to the sender and its
addressed recipients. Internal receipt history is never sent in join, sync, or
extension frames. Nitro and Cloudflare use the same awareness functions and room
contract; Cloudflare retains negotiated context in its hibernation attachment.
New clients connected to an older server retain basic presence and hide unsupported
attention controls.

## Presence state

`foreground` describes current visibility/focus. `activity` is `viewing` or
`editing`; local editor input changes activity, remote document operations do not.
Existing liveness and activity timestamps remain separate. Heartbeats are 10 s;
membership expires after 30 s. A coarse home summary groups tabs by person and
counts editing only for foreground activity within the last 5 s.

The web adapter publishes the latest selection, cursor and state together at most
once every 50 ms. Hidden or blurred pages clear detailed locations. Disabling
“Share detailed location” also removes caret/selection publication, while basic
membership remains visible. The People panel derives section names from a valid
shared block ID in the local replica; it does not guess unavailable locations.

Before DOM measurement, active foreground participants with resolvable block IDs
are ranked by distance from the local block, then editing state and stable session
order. At most five receive detailed geometry; at most three get expanded labels.
Each selection is clipped to the viewport and bounded at 100 rectangles. The full
grouped roster remains available independently of these limits. Focus mode hides
peripheral overlays and keeps direct invitations retrievable in People and
activity; it never implies invisibility.

## Attention delivery

`sendAttention` accepts typed actions: invite, respond (accept/dismiss), cancel,
present, follow, suspend, resume and stop. It returns an identified explicit
success/failure outcome. State updates are coalescible; attention commands are a
separate bounded stream.

- IDs and session targets are bounded to 128 characters; invitations address
  1–100 distinct sessions already in the authorized room.
- The server sets the invitation lifetime to 30 s. Acceptance after expiry fails.
  A recipient's response suppresses that invitation without changing its editor.
- Successful command IDs are deduplicated for 30 s, retaining at most 32 receipts.
  Commands are limited to four per second, invitations to one per five seconds.
- A client retains at most four in-flight commands, retries the same ID after
  one second and gives up after four seconds. Disconnect resolves pending work as
  unavailable; expired gestures are not queued for reconnect replay.
- Collaboration state has its own monotonic revision. Stale extension state and
  frames from another room are ignored independently of cursor clocks.

## Follow and return state machine

| State | Entry | Exit |
| --- | --- | --- |
| Independent | Initial state or successful Return | Open an addressed invitation |
| Shared context | Explicit Open here captures the writer's return anchor | Explicit Follow or Return |
| Following | Explicit Follow; presenter has opted in | Local scroll, editing or navigation suspends; Return stops |
| Suspended | Local intent, view change, interrupted connection | Explicit Resume validates the presenter again |
| Ended | Presenter leaves/stops, access/link loss, attention disabled, or document exit | Existing return action remains available while still in the document |

Pointer movement does not suspend. Invitations never move focus, selection,
scroll position or the mobile keyboard. Continuous following is a separate action
from opening context. A presenter cannot follow another presenter, preventing
cycles. Reconnect never resumes automatically.

On sufficiently wide screens, a second Lexical DOM is a read-only projection of
**the same replica**. Its binding subscribes to local and remote changes but has
no outbound editing listener, session or transport. The active editor stays
mounted across context, preview, Markdown, LaTeX and theme changes. The split is
allowed only when each pane can be at least 360 px wide. Compact layouts expose
My place, Shared view and Return around one full-width surface.

Edit here transfers a stable anchor into the existing editor after suspending
follow. Transfer waits for IME composition to finish and cancels pending callbacks
when the binding changes or unmounts. Returning tries the original passage, then
the nearest captured surviving heading, then document start, with an explanation
when fallback was needed. Unresolved geometry does not become a fabricated caret.
Up to 20 recently used document anchors per account are stored locally without
text; reopening only scrolls to an anchor that still resolves and never focuses
or selects text automatically.

Anchor capture and resolution reuse the immutable sequence projection held by
the materialized block revision. Local transactions and remote integration replace
that state atomically. Cursor lookups no longer replay the event graph per caret.
Unknown atoms still return `null` from the tolerant API; malformed anchors still
fail. Anchor serialization and document event formats are unchanged.

## Rollback and evidence

The four server environment switches are independent:
`SOFTMAPLE_REDESIGN_SHELL`, `SOFTMAPLE_REDESIGN_PRESENCE`,
`SOFTMAPLE_REDESIGN_ATTENTION`, and `SOFTMAPLE_REDESIGN_FIELD`.
Set a switch to `false` to disable its feature. No stored document format depends
on them. An active editor is not keyed by these flags.

The shell switch restores the legacy palette/navigation; shared document-session
correctness fixes remain. The detailed-presence switch removes overlays; the
attention switch removes new negotiation/UI; the Field switch uses List. These
are environment rollout controls, not an authorization layer or a live remote
flag service. See the validation report for measured limits and release gates.
