# Collaboration-first redesign: implementation record

## Product boundary and release status

The implemented journey is notice → invite → work together → return. Live
collaboration still requires public-link mode. Anonymous sharing stays read-only;
workspace owner/editor/viewer roles remain authoritative. No comments, inbox,
mentions, access requests, reaction placeholders or content-schema migration.

The redesign is implemented on `codex/collaboration-redesign`. **Production
release is blocked by measured editing latency and incomplete capacity/device
acceptance.** See [validation](./redesign-validation.md). A successful build or
workflow suite does not imply performance acceptance.

## Audit and implementation sequence

The foundation is Next.js 16.3, React 19.2, Radix controls, next-themes, Lexical
0.44, stable sequence anchors, event-based document replication, grouped presence
and a shared Nitro/Cloudflare presence runtime. Existing heartbeat/expiry values
already matched the proposed 10/30 seconds.

The implementation addressed editor tab unmounting, merged save/connectivity
status, seasonal styling, unbounded geometry, missing addressed attention/follow
contracts, capped document retrieval and loaded-record-only search. The approved
plan preceded major changes; work then followed these milestones:

1. Local Supabase configuration, existing migration application, explicit
   loopback-only seeding and independent owner/editor/viewer fixtures.
2. Semantic light/dark tokens, shell, responsive navigation, local preferences
   and reusable presence/attention controls.
3. Persistent editor subtree and replica, independent save/live status, bounded
   relevant presence geometry and section-relative activity.
4. Expiring addressed invitations, explicit presenting/following, suspension,
   resume, read-only shared projection, IME-aware transfer and return anchors.
5. Field/List home, paginated title search, authorized coarse room summaries,
   workspace/account settings, sharing, authentication and public reading.
6. Browser, contract, Storybook and accessibility checks; route screenshots;
   measured performance and revision-scoped anchor projection optimization.

## Route and state checklist

| Surface | Implemented treatment | Evidence |
| --- | --- | --- |
| `/` | Branded attention demonstration, explicitly simulated | `landing`; public browser suite |
| `/login`, `/signup` | Responsive forms and destination handling | `login`, `signup`; auth browser tests |
| `/reset-password`, `/reset-password/update` | Recovery forms and session states | `reset-password`, `update-password`; recovery tests |
| `/dashboard` | Resume and choose workspaces | `dashboard`; navigation tests |
| `/workspace/[workspaceSlug]` | Field/List, local pins/recent places, title filtering, pagination | `home`; 31-document browser regression |
| Workspace `doc/new` | Accessible document creation | `new-document`; core creation test |
| Workspace document | Stable editor, four views, save/live states, outline, presence/attention | `editor`; co-editing/attention tests |
| `/share/[docSlug]` | Anonymous read-only reader | `public-reader`; disabled-link denial test |
| Workspace settings | Administration and URL-controlled members tab | `workspace-settings`, `members`; permissions tests |
| `/settings/account` | Profile, theme, collaboration preferences and account actions | `account`; profile/appearance tests |
| Empty workspace | New-document path and empty composition | `empty-workspace` |
| Loading/error/not-found | Branded state primitives and recoverable messages | `not-found`; recovery unit/browser tests |
| Legacy URLs | Coming-soon/signup and team-settings/dashboard redirects retained | Existing handlers; public tests |

No placeholder secondary navigation was introduced. Cmd/Ctrl+K still inserts a
link inside editing; outside text inputs it opens document search. Search is
explicitly title-based. Existing exports, private HTTP saves, shared WebSocket
synchronization and pending-event recovery paths remain in use.

## Shared foundation and awareness

See [token/component map](./redesign-tokens.md) for colors, typography, surfaces,
navigation and motion. See [awareness contracts](./shared-attention-contracts.md)
for compatibility, identity, delivery, privacy, limits and transitions.

The existing awareness library was extended rather than replaced. Richer frames
are negotiated while v2 clients continue to receive basic presence. Both hosts
use the same contract. No disposable presence state is persisted as content.

Four independent server switches control shell, detailed presence, attention and
Field view. Setting one to `false` disables that feature. Flags do not key/remount
the editor or change stored documents. They are deployment configuration, not a
live flag service or substitute for permission checks.

## Shared-attention walkthrough

1. In a public-link document, open **People and activity**, select recipients,
   and select a passage or place the caret. **Look here** shows the audience.
2. The recipient receives one quiet invitation. Arrival does not change focus,
   selection or scroll. They choose **Open here**; unaccepted invitations expire
   on the server after 30 seconds.
3. Opening preserves the return anchor. Wide layouts place a read-only projection
   beside the existing editor, with a yellow seam. Compact layouts expose
   **My place**, **Shared view** and a persistent return action.
4. The sender opts into presenting. **Follow presenter** is a separate recipient
   action. Local editing, scrolling or navigation suspends follow; pointer motion
   does not. Reconnect requires explicit **Resume**.
5. **Edit here** transfers the location into the existing editor after composition
   ends. **Return to my place** restores the prior anchor. Removed anchors fall
   back to a surviving captured section, then document start, with an explanation.
   Presenter departure or access loss ends the relationship.

## Reproduce local review

Run from the repository root with Docker Desktop and dependencies installed:

```sh
node apps/web/scripts/local-e2e.mjs --prepare
node apps/web/scripts/redesign-review.mjs serve
node apps/web/scripts/redesign-review.mjs seed
```

Stop the review server before `redesign-review.mjs test` (Playwright owns its
servers) or `redesign-review.mjs build`. Build Nitro with
`pnpm --filter @softmaple/collab-nitro build`, then use
`redesign-review.mjs serve-production` for production measurements.
`redesign-review.mjs capture`, `redesign-interactions.mjs attention`, and
`redesign-interactions.mjs accessibility` produce review evidence.

Credentials, auth state, fixtures, logs and images live in ignored
`.artifacts/redesign/`; never commit its private JSON files. See the
[screenshot index](./redesign-screenshots.md). Earlier temporary milestone images
were lost when temporary storage was cleared; final route and interaction images
were recreated in this persistent directory. No surviving original authenticated
visual or timing baseline is claimed.
