# Collaboration-first redesign — handoff

Branch: `claude/softmaple-collaboration-redesign-1kfs03`.

This is the state of the work, what was verified and how, and what is left.
It is written to be read by somebody picking the work up, so the "not done"
sections are as specific as the "done" ones.

---

## 1. Route checklist

| Route | State | Notes |
| --- | --- | --- |
| `/` | Redesigned | New palette; hero reflows at 320px and 200% zoom; the demonstration card is labelled as simulated in both the accessible name and visible text |
| `/login` | Redesigned | Tokens applied; links use `--link`, not the action yellow |
| `/signup` | Redesigned | As above |
| `/reset-password` | Redesigned | As above |
| `/reset-password/update` | Redesigned | Tokens only; not screenshotted (requires a recovery link) |
| `/coming-soon` | Redesigned | Preserved as a redirect target |
| `/dashboard` | Tokens only | Not restructured around resuming; see §6 |
| `/workspace/[slug]` | Redesigned | Field/List home over the first page of documents, bounded clusters, per-workspace view preference |
| `/workspace/[slug]/doc/[slug]` | Redesigned | Stable editor shell, split save/connectivity status, People and activity context slot |
| `/workspace/[slug]/doc/new` | Tokens only | Form unchanged |
| `/workspace/[slug]/settings` | Tokens only | Composition not reworked; see §6 |
| `/share/[docSlug]` | Tokens only | Access restrictions unchanged; reading surface not reworked; see §6 |
| `/settings/account` | Tokens only | Motion / focus-mode / detailed-location preferences exist but are not yet surfaced here; see §6 |
| `/settings/team` | Unchanged | Legacy redirect preserved |
| Loading / error / not-found | Tokens only | `StatePanel` exists and is used by the document list; the route-level states still use `RouteLoading` / `RouteError` |

Preserved throughout: every URL, the Owner/Editor/Viewer permission model,
anonymous read-only sharing, Markdown and LaTeX export, and pending-event
recovery.

---

## 2. Token map

Source of truth: `apps/web/app/design.css`. Mirrored as data in
`apps/web/lib/design/palette.ts`, and the two are asserted equal by
`apps/web/lib/design/palette.test.ts`.

| Semantic token | Light | Dark | shadcn alias |
| --- | --- | --- | --- |
| `--surface-workspace` | `#f4f3ee` | `#111315` | `--background`, `--sidebar` |
| `--surface-document` | `#fffefa` | `#191c1f` | `--card` |
| `--surface-raised` | `#ffffff` | `#22262a` | `--popover` |
| `--surface-quiet` | `#eae8e1` | `#1d2124` | `--secondary`, `--muted` |
| `--content` | `#191a17` | `#ecedea` | `--foreground` |
| `--content-secondary` | `#63645c` | `#a2a7a5` | `--muted-foreground` |
| `--divider` | `#dedcd3` | `#2c3135` | `--border` |
| `--input-boundary` | `#c9c7bc` | `#3c4247` | `--input` |
| `--action` | `#ffd523` | `#ffd94a` | `--primary` |
| `--action-contrast` | `#1f1a00` | `#1a1600` | `--primary-foreground` |
| `--attention-surface` | `#fdf3cd` | `#2e2712` | `--accent` |
| `--emphasis` | `#7a5a00` | `#ffd94a` | — |
| `--focus` | `#1b57e0` | `#9cc0ff` | `--ring` |
| `--link` / `--link-hover` | `#1f4fd8` / `#163cae` | `#8fb6ff` / `#b4cfff` | — |
| `--feedback-positive` | `#2e6b3e` | `#7fd196` | `--success` |
| `--feedback-caution` | `#8a5a00` | `#f0b44a` | — |
| `--feedback-critical` | `#b3261e` | `#ff9a92` | `--destructive` |

Geometry: 8px controls (`--radius`), 12px panels (`radius-xl`), 64px rail,
240–280px navigator, 56px document header, ~720px prose measure, 44px minimum
touch target.

**The rule the palette is built on.** `--action` is yellow and is only ever a
*fill*. Yellow at this lightness has about 1.3:1 contrast against the light
workspace, so yellow text or a yellow focus ring is invisible. Accent *text* is
`--emphasis`, links are `--link`, focus is `--focus`. One test deliberately
asserts that light action yellow fails as text, so relaxing the fill-only rule
has to be a decision rather than an accident.

**`text-primary` audit.** Twenty-five call sites used `text-primary` for actual
text and would have become unreadable. Labels, eyebrows and brand accents moved
to `text-emphasis`; navigational text moved to `text-link`. In
`@softmaple/ui`, the `link` button variant and the empty-state link hover moved
to `--link`, and the package now ships its own neutral `--link` / `--emphasis`
defaults so it no longer assumes `--primary` is legible as text.

---

## 3. Awareness gap and change report

### Closed

| Gap | Change |
| --- | --- |
| Editor subtree unmounted on view change | Document session hoisted above view selection; panels always mounted (`components/shell/view-switcher.tsx`), with a test that counts mounts |
| Save and sync collapsed into one label | Two independent descriptors (`modules/docs/document-status.ts`); a connectivity problem can no longer imply the work is unsaved |
| Remote geometry measured for every peer, uncapped | Ranked and cut *before* measurement (`modules/docs/presence-relevance.ts`): 5 carets, 3 expanded labels, overflow counted not hidden |
| Precise location published from a hidden tab | Publication stops on `visibilitychange` and the last position is withdrawn; membership unaffected |
| Location publication rate unstated | Named ceiling of 20 updates/second |
| Collaborator colours could collide with actions or status | Theme-paired palette excluding the yellow band, asserted by tests; the auth specimen's fake caret no longer uses the success colour |
| Activity was document-wide | Section-relative (`modules/docs/document-sections.ts`) plus an uncapped, readable People and activity view |
| Document list capped at 100 and searched client-side | Keyset pagination and database-side title filtering |
| Cmd/Ctrl+K had no non-editor meaning | Opens search outside editable targets; Lexical keeps it for link insertion inside text |
| `@theme` tokens in `design.css` generated no utilities | `design.css` now imports the design system and is the app's single Tailwind entry — this had silently broken `font-display` everywhere |

### Added contracts

`packages/awareness/src/attention`, documented in
[shared-attention.md](./shared-attention.md): session identity, the
state-versus-commands split, addressed expiring invitations, the follow state
machine, delivery outcomes, and version-3 capability negotiation that keeps
existing v2 clients working.

### Open

- **No client half for attention.** The wire is live — presence rooms and both
  host codecs route, expire, deduplicate and authorise attention commands — but
  `apps/web` does not yet mint a session id, publish attention state, send a
  command or render an invitation. This is the remaining blocking item for
  Phase 4, and why `sharedAttention` is still off.
- **No batch presence-overview interface** for the workspace home, so home
  shows no coarse presence summaries yet.
- **`deriveDocumentUiStatus` still exists** and is still used by the public
  read-only view, which wants one word. It is no longer the only option.

---

## 4. Shared-attention walkthrough

Contracts, client state and the transport exist; the browser does not yet
speak, so the journey is not yet exercisable end to end. The intended sequence,
and where each step lives:

1. **Look here** — `createInvitation` builds an addressed invitation with a
   30-second expiry from the sender's caret or selection plus a
   `SemanticLocation` fallback.
2. **Arrival** — `receiveInvitation` refuses duplicates, wrong addressees and
   already-expired invitations. Arrival must not move focus, selection,
   viewport or the mobile keyboard.
3. **Open here** — the recipient's current position is captured as a
   `ReturnAnchor` before anything moves.
4. **Follow** — `follow:start` requires the presenter to have set `presenting`,
   and is refused with `cycle` if it would form a loop.
5. **Suspend** — scrolling, editing, navigating, asking to edit, or
   disconnecting. Pointer movement does not.
6. **Resume** — always deliberate, including after a reconnect.
7. **End** — six named reasons; an ended relationship never revives on its own.
8. **Return** — the section the block was in, then the remembered section index
   clamped to a shortened document, then the start; never an invented position.

Steps 1–8 are implemented as pure, tested logic, and the server routes and
authorises them. What is missing is the browser end: minting a session id,
publishing attention state, sending commands, and rendering an invitation that
never steals focus.

---

## 5. Screenshot index

`docs/design/assets/redesign/<route>--<viewport>-<theme>.png`, 50 files.

Routes: `landing`, `login`, `signup`, `reset-password`, `coming-soon`.
Viewports: `desktop` (1440×1000), `mobile` (390×844), `tablet-1024`,
`narrow-320`, `zoom-200` (720×500 at 2× device scale).
Themes: `light`, `dark`.

Captured by `apps/web/scripts/redesign-screenshots.mjs` against a production
build. Theme comes from the browser context's `colorScheme`, which `next-themes`
reads through `defaultTheme="system"` — nothing is injected into the page, so
the screenshot is what a visitor gets.

**Authenticated routes are not screenshotted.** They need a running Supabase,
which this environment could not start (§6).

---

## 6. Measured validation report

### Environment

- Linux 6.18.44, Node 22.22.2, pnpm 11.11.0, Next.js 16.3.0.
- Chromium via Playwright 1.60.0 (`/opt/pw-browsers/chromium`).
- Production build (`next build` + `next start`), not dev mode.

### What passed

| Check | Result |
| --- | --- |
| `pnpm --filter @softmaple/web test` | 273 passed |
| `pnpm --filter @softmaple/awareness test` | 661 passed |
| `pnpm turbo run build` | 13/13 packages |
| `pnpm turbo run typecheck` | 22/23 (see below) |
| `pnpm --filter @softmaple/web lint` | clean, 0 warnings |
| Responsive spill check | 25/25 route × viewport combinations clean |

### Known failures, all pre-existing and unrelated to this work

- **Storybook component tests cannot run in this environment.**
  `packages/awareness` and `packages/editor` each define a Vitest `storybook`
  project that runs in a real browser through `@vitest/browser-playwright`. It
  fails deterministically:

  ```
  browserType.launch: Executable doesn't exist at
  /opt/pw-browsers/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell
  ```

  The image provides `chromium_headless_shell-1194`; the bundled
  playwright-core wants build 1223. Ten test files in `awareness` and the
  equivalent in `editor` are therefore not executed, and their launch failure
  surfaces as an unhandled error that intermittently fails the whole
  `turbo run test` (this is what appeared as flakiness in `awareness` and
  `editor`). The non-browser projects run and pass: 661 tests in `awareness`.

  **Consequence for the brief: the required Storybook MCP tests were not run.**
  Component changes in `@softmaple/ui` and `@softmaple/awareness` need them on a
  machine with the matching browser build.

- **`@softmaple/playground` typecheck** fails on a missing generated
  `routeTree.gen.ts` (gitignored, produced by the dev server). Fails identically
  on `next` at the branch point.

- **`packages/block-model` property test** (`convergence.property.test.ts`,
  fast-check, random seed) failed twice during this session and passed in the
  twelve runs afterwards, including with `--force` to defeat caching. It is a
  genuine flake; the counterexample was not captured. `block-model` was not
  modified by this work. `packages/bench` failed once under a parallel turbo run
  and passed in twelve subsequent runs; it was not characterised.

### What could not be run here, and why

- **Local Supabase.** `supabase start` fails: the environment's network policy
  refuses `production.cloudfront.docker.com` and `d5l0dvt14r5h8.cloudfront.net`
  (both registries' blob CDNs) with 403 at the proxy, so no container image can
  be pulled. Confirmed with a direct `docker pull`. The configuration, the
  migrate-on-start script and the loopback-only seeding path are written and
  reviewable, but unexecuted. See [local-verification.md](./local-verification.md).
- **Authenticated browser verification**, and therefore every two-session test:
  concurrent editing, IME, invitation behaviour during typing, follow
  suspension and resume, presenter departure, permission revocation, reconnect,
  multi-tab, and old/new client compatibility.
- **Playwright suite.** `playwright.config.ts` starts its own servers and needs
  Supabase credentials. The responsive spill assertion was instead run directly
  against the production build (25/25 clean) and added to `e2e/public.spec.ts`
  for CI.
- **Performance measurement.** The 10,000- and 50,000-word fixtures with
  2/10/25 editors, and the 100-viewer capacity scenario, need real sessions.
  **No latency numbers were produced, and none should be assumed.** The brief's
  budgets remain unmeasured targets.
- **Storybook MCP tests.** Not run — see the browser-build failure above.

### A bug this work found

The existing 320px test asserted `scrollWidth - clientWidth <= 0`. Because the
body sets `overflow-x: clip`, that difference is always zero however far content
spills — so the assertion passed while the landing headline was being sliced in
half at 320px. The replacement measures element rectangles against the viewport.
Both the layout bug and the blind test are fixed.

---

## 7. Rollback

Four independent server-read flags, each with its own variable
(`apps/web/lib/feature-flags.ts`): `shell`, `detailedPresence`,
`sharedAttention`, `fieldView`. `sharedAttention` defaults **off** because its
transport does not exist yet; the rest default on.

Flags gate props and sibling chrome only. A flag must never key or swap the
editor element itself — that would unmount the Lexical editor and its replica,
which is the exact failure Phase 3 removed.

No stored document changes in any of this work, so every flag is a pure
presentation rollback.

---

## 8. What to do next, in order

1. Wire the client half: mint a tab-scoped session id and send it with auth,
   publish `AttentionState` into presence meta (`attentionMeta`), send commands
   over the `attention` wire type, and render an incoming invitation that moves
   neither focus, selection, viewport nor the mobile keyboard. Then turn
   `sharedAttention` on.
2. Build the read-only projection pane over the same replica — no second
   transport session, no outbound operations — and "Edit here", deferring the
   transfer during IME composition.
3. Add the bounded, authorized batch presence-overview interface, and use it for
   home. An unavailable summary must not render as an empty room.
4. Rework the remaining routes marked "tokens only" in §1, starting with the
   public reading surface and account settings, where the motion, focus-mode and
   detailed-location preferences still need a home.
5. Run everything in §6 that could not be run here.
