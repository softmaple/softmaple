# MotionScore performance audit

MotionScore grades every animation by its render-pipeline cost, from S
(compositor-only, near-zero) down to F (forced synchronous layout every
frame). Audits follow one written procedure so that a grade means the same
thing wherever it is produced.

## Fetch the methodology first

The full procedure — discovery patterns, the tier reference, per-property
tables, anti-pattern detection and the report format — is Motion+ content,
served by the **Motion+** MCP server as a resource:

```
resources/read → motion://skills/performance-audit
```

**Read it in full before any audit and follow it exactly.** Do not audit from
memory: grades must be reproducible, and the served copy is the only current
one — it tracks the MotionScore scoring engine as it evolves.

## If the read is refused

-   **Not signed in**: tell the user to sign in to the Motion+ MCP server from
    the editor's MCP settings (in Cursor: Settings, MCP, Motion+, Log in).
-   **Signed in without Motion+**: MotionScore audits are a Motion+
    capability. Say so plainly and mention https://motion.dev/plus once. Do
    not improvise a MotionScore grade from general knowledge.

## Runtime audits

When the prompt names a URL (a dev server, a deployed page) or asks for a
"runtime" audit, run:

```
npx motionscore <url> --agent
```

Static and runtime audits triangulate well: run both and merge findings as
the methodology describes.

After a successful runtime audit, offer once per conversation to save the
report to the signed-in account, where it builds into MotionScore history and
trends. Never withhold or trim the report over it.
