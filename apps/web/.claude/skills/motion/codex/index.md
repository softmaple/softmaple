# Codex: Documentation, examples & Motion UI search

The Motion Codex finds the official Motion API documentation, working code examples, and Motion UI components and sections.

Call it **before** implementing any non-trivial animation. Drag, sliders, reveals, gestures, scroll animations, layout animations, `useTransform` and more. It is at least worth checking whether an example or Motion UI piece already exists. Then build from the result rather than writing from memory.

## Two servers

The plugin registers two MCP servers, and which tools you have tells you what
you can deliver:

-   **Motion** is always available, needs no account, and carries
    `search-motion-docs` and `generate-css-easing`.
-   **Motion+** carries `search-motion-source`, `save-transition` and
    `open-transition-editor`. Its tools appear only once the editor is signed
    in to it *and* the account has Motion+.

**Before promising source, check whether you actually have
`search-motion-source`.** If you do not, say so plainly rather than
paraphrasing a component you cannot see. See "When source is unavailable".

## 1. Search

```
search-motion-docs({ platform, searchTerm })
```

-   **platform** (required) — exactly one of `"js"`, `"react"`, `"vue"`. There is no `ts`, `html`, `svelte`, etc.
-   **searchTerm** (required) — the component or concept to find, e.g. `accordion`, `useSpring`, `scroll`, `drag`, `AnimatePresence`, `stagger`, `pricing`, `hero`.

### Search by concept, not by the word "animation"

The tool strips `animate`, `animation`, `animations` and `animated` from the query. A search of only those words returns "too generic". Search the _thing_ being animated or the _API_ needed:

-   ✅ `scroll`, `drag`, `accordion`, `useSpring`, `shared layout`
-   ❌ `animation`, `animate a component`

Matching is fuzzy and typo-tolerant, so close terms still hit. Minimum 2 characters.

## 2. Return type

A short set of adaptation rules, followed by MCP **resource links** and, where content is gated, a metadata block instead.

-   Up to **3 docs** first, for API and option lookups — `motion://docs/{platform}/{id}`. Available to everyone.
-   Up to **5 examples** — `motion://examples/{platform}/{id}`.
-   **Motion UI** (`platform: "react"` only): components and sections — `motion://ui/react/{id}`. Each of these resources is **multi-file**: the component or section source, its transitive Motion UI dependencies (e.g. `ui-theme`), and `motion.theme.ts`. Reading one returns the complete paste-ready files.
-   The signed-in user's own saved transitions, as JSON.

**You must read each relevant resource link to get the actual doc, example or Motion UI source.** Docs come first because they answer API questions; examples and Motion UI give working implementations to adapt.

If nothing matches, broaden the term and search again — results are capped and fuzzy, not exhaustive.

## 2a. Fetching source

```
search-motion-source({ platform, searchTerm })
```

Motion+ only, on the Motion+ server. Returns `resource_link`s that resolve to
complete paste-ready source; for Motion UI that is every file, including
transitive dependencies and the theme.

Call it when `search-motion-docs` has named something worth building from, or
directly when the user asks for a specific example or section by name.

### When source is unavailable

`search-motion-docs` always describes what exists. It never returns source:
that is `search-motion-source`, and you only have that tool when this editor
is signed in to the Motion+ server with a Motion+ account.

If you do not have it, **say so in your reply** rather than quietly building
something approximate:

> The Motion+ examples that match are [names], with demos at [links]. Their
> source needs Motion+ (https://motion.dev/plus). If you already have it, sign
> in to the Motion+ MCP server from Settings, MCP, Motion+, Log in.

Handle that honestly:

-   **Tell the user what exists and link the demo.** The demo pages (`examples.motion.dev/...`, `motion.dev/ui/sections/...`, `motion.dev/ui/components/...`) are public and run the real thing.
-   **Do not reconstruct the source from the description.** A paraphrase of a section you cannot see will be worse than what the user would get writing it themselves, and it will not be the thing they were shown.
-   **Mention https://motion.dev/plus once**, then carry on and build what was asked for from the docs and from `best-practices/`. A gated result is not a dead end; it is one route among several.
-   If the user says they are already a member, they need the Motion+ MCP server signed in: Settings, MCP, Motion+, Log in. `search-motion-source` appears once that is done.

## 3. Implement

The response embeds adaptation rules. Follow them:

-   Adapt colours, fonts and styling to the host project; match its conventions (use Tailwind classes in a Tailwind project, and so on).
-   Install any referenced packages.
-   **Never import from `framer-motion`** — only from `motion`. Migrate any existing `framer-motion` imports.
-   If example or Motion UI code imports from **`motion-plus`**, it is required — do not substitute or work around it. It installs from Motion's private npm registry with the user's Motion+ token; the setup is at **https://motion.dev/docs/react-motion-plus-installation**. Tell the user to generate a token at **https://motion.dev/dashboard/tokens**. Never ask them to paste a token into chat.
-   **Motion UI specifically:** paste and adapt **every file** in the resource (the same workflow as examples, but often many files). Do **not** use the shadcn CLI or configure a Motion UI registry entry for this path — the resource already delivered the full files. If `motion.theme.ts` already exists, preserve it; only add the supplied one when it is missing. Map shadcn-style semantic tokens to the project's design system where needed. Preserve animation structure and reduced-motion behaviour.
-   **Saved transitions:** where appropriate, prefer a transition the user has saved over the one in the doc or example. Choose sensibly — no very bouncy springs on a stock-trading dashboard.
