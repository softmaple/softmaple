# Redesign validation and release gates

## Decision

**Do not release as performance-accepted.** Core workflow and contract checks
pass, but the 50 ms input target is missed on every completed stress fixture.
Larger rendered rooms time out waiting for convergence. A timeout does not by
itself establish content loss; it is nevertheless a failed acceptance gate.

## Reproducible evidence

Evidence is retained in ignored `.artifacts/redesign/`. The local Supabase stack
uses loopback ports, the repository's existing 26 migrations and explicit local
service-role test grants. Independent test users cover owner/editor/viewer roles,
public/private documents and unauthorized workspace access. Production content
schema and remote seed safeguards are unchanged.

| Check | Result | Log |
| --- | --- | --- |
| Block model, including convergence properties and revision-sensitive anchors | 29 passed | `block-model-tests.log` |
| Lexical binding, including read-only projection and selection behavior | 30 passed | `binding-tests.log` |
| Awareness/protocol | 618 passed | `awareness-tests.log` |
| Shared presence/document runtime | 100 passed | `runtime-tests.log` |
| Nitro host | 115 passed | `nitro-tests.log` |
| Cloudflare host | 59 passed | `cloudflare-tests.log` |
| Web unit/behavior tests | 171 passed | `web-tests.log` |
| Authenticated/public browser workflows | 20 passed | `e2e.log` |
| Storybook MCP interactions and accessibility | 52 stories passed | `storybook-tests.json` |
| Seven affected package/app typechecks | Passed | `typechecks.log` |
| Web lint | Passed | `web-lint.log` |
| Production web and Nitro builds; Cloudflare dry-run bundle | Passed | `web-build.log`, `nitro-build.log`, `cloudflare-build.log` |

Browser coverage includes concurrent editing, editor DOM preservation across
views, save-before-sharing, anonymous read-only access and link revocation,
invitation arrival while focused, read-only projection, local-intent suspension,
explicit resume after an actual socket close, presenter stop and return. It also
covers profile/settings, URL-selected members, redirects, role restrictions,
31-document pagination, unloaded-title search, pin persistence and 320 px controls.

Contract tests cover expiry, deduplication, invalid/stale messages, authorization,
follow eligibility/cycles, old-client fallback and both host codecs. Binding tests
cover composition-aware behavior; they do not replace real operating-system IME
or mobile keyboard testing.

## Performance method

Reference hardware: Apple M1, 8 logical CPUs, 16 GiB RAM, macOS Darwin 25.6.0,
arm64; Node 24.12.0; Chromium 148.0.7778.96. The app uses a production Next build
and built Nitro server with isolated local Supabase. All participants and services
share this machine, so these are reproducible stress measurements, not estimates
of a geographically distributed fleet or low-end phone.

Mixed-language 10,000- and 50,000-word documents use paragraph, heading and quote
blocks. Rendered cases use independent authenticated browser contexts and eight
concurrent rounds of unique inserted markers, checking all replicas for all
markers. The harness delays browser-native WebSocket sends and incoming delivery
by 40 ms each: an **80 ms modeled message-queue roundtrip**, without actual network
jitter, loss or OS-level shaping. Input latency measures `beforeinput` to the next
animation frame; it is a rendering proxy, not a physical display measurement.

Geometry samples are short-lived User Timing durations around the bounded
presence geometry calculation. They include anchor lookup and DOM measurement,
exclude React commit/paint, contain no text or identity, and are not transmitted.
Remote caret/attention end-to-end display latency was not measured; document
convergence must not be substituted for that metric. No pre-redesign timing
baseline survives, so no baseline regression claim is made.

| Words | Rendered editors | Input p95 | Geometry p95 | Concurrent round p95 | Outcome |
| --- | ---: | ---: | ---: | ---: | --- |
| 10,000 | 2 | 523.7 ms | 2.2 ms | 775.5 ms | 8/8 converge; input target fails |
| 10,000 | 10 | 2,137.0 ms | 21.1 ms | 11,107.2 ms | 8/8 converge; input target fails |
| 10,000 | 25 | Unavailable | Unavailable | Unavailable | All open; first convergence wait exceeds 45 s |
| 50,000 | 2 | 2,645.9 ms | 9.1 ms | 3,788.3 ms | 8/8 converge; input target fails |
| 50,000 | 10 | Incomplete | Incomplete | Incomplete | Five rounds converge; later wait exceeds 45 s |
| 50,000 | 25 | Unavailable | Unavailable | Unavailable | All open; first convergence wait exceeds 45 s |

The separate **100-viewer transport scenario passed**: 100 independent viewer
accounts joined presence and loaded read-only document history, with 200 sockets
ready in 5,066 ms. This does not claim 100 rendered DOMs or caret latency. The
first capacity harness attempt omitted presence sync and used a disallowed query
on the same-origin document route; it was corrected and its failure is excluded
from capacity conclusions. Interrupted local-service runs are also excluded.

Before revision-scoped projection reuse, the same two-editor 10,000-word fixture
measured geometry p95 597.9 ms, input p95 799.2 ms and round convergence p95
5,851.7 ms. Reusing the materialized sequence projection removed repeated full
anchor replay. Editing still rebuilds/materializes document state synchronously;
that is the next profiling target. Do not hide the residual cost by disabling
presence or reporting only the geometry improvement.

Reproduce one case with:

```sh
node apps/web/scripts/redesign-benchmark.mjs .artifacts/redesign/local-env.json 10000 2
node apps/web/scripts/redesign-benchmark.mjs .artifacts/redesign/local-env.json 50000 25
node apps/web/scripts/redesign-benchmark.mjs .artifacts/redesign/local-env.json 10000 100 --viewers
```

## Visual and accessibility evidence

See [screenshots](./redesign-screenshots.md) for 15 routes in four theme/viewport
variants, additional 1024/320 widths, 200% CSS zoom and forced colors, plus the
real two-account invitation/follow/return journey. The landing simulation is
explicitly labeled. Focus and selection preservation are asserted during
invitation capture. Automated route audits use axe-core 4.11.0 and WCAG 2/2.1 A/AA
plus best-practice checks after theme transitions settle.

The audit identified and fixed the editor main landmark, semantic utility
registration in the shared Tailwind entry point, and persistent underlines for
authentication links. All 60 route/theme/viewport audits passed with zero reported violations;
results and manual-review items are retained in `accessibility.json`.
Automated accessibility does not prove full assistive-technology compliance.

The final route capture also checks that visible header actions and view tabs
fit inside 320 px and retain 44 px heights. The route capture produced 64 images
and 62 overflow checks with zero page errors or document overflow. Real-session
attention capture produced 12 images across the four appearance variants.

## Remaining release acceptance

- Resolve synchronous editing latency and rerun the same matrix; inspect failed
  convergence cases before treating larger rooms as supported.
- Measure end-to-end caret and attention latency against the under-200-ms target,
  separately accounting for transport, queueing and rendering.
- Verify real OS IME composition, mobile keyboard visibility, screen-reader
  workflows, true browser 200% zoom and low-end mobile hardware.
- Exercise packet loss and out-of-order delivery at the browser transport level,
  beyond the protocol/unit coverage; validate permission revocation while actively
  following and disabled-sharing termination in independent live sessions.
- Validate deployed Cloudflare runtime capacity separately. Local host contract
  parity and dry-run bundles are not a deployed capacity test.

The four independent feature switches permit rollback without rewriting stored
documents. No deployment, commit or push is part of this handoff.
