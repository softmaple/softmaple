# `@softmaple/eslint-config`

Shared eslint configuration for the workspace.

Four flat-config entry points build on one base, plus a set of layering rules
that mechanically enforce the collaboration architecture.

## Architecture

```text
                          eslint.config.js
                    root · per-app · per-package
                                  │
            ┌─────────────────────┴─────────────────────┐
            │                                           │
          /base                               /collaboration-layers
     js.recommended                           no-restricted-imports
    typescript-eslint                           layer boundaries
     config-prettier                                    │
      plugin-turbo                              spread alongside
            │                                  any config at left
   ┌────────┴──────────┐
   │                   │
/next-js        /react-internal
apps/web    ui · awareness · editor
```

`/collaboration-layers` is additive, not a variant: a package spreads it
*alongside* whichever base it already extends.

## Entry points

| Subpath | Use in |
| --- | --- |
| `@softmaple/eslint-config/base` | Any TypeScript package |
| `@softmaple/eslint-config/next-js` | `apps/web` |
| `@softmaple/eslint-config/react-internal` | React component packages (`ui`, `awareness`, `editor`) |
| `@softmaple/eslint-config/collaboration-layers` | Collaboration model, binding, protocol, and runtime packages |

```js
// packages/<name>/eslint.config.js
import { config } from "@softmaple/eslint-config/base";
import { egWalkerCollaborationConfig } from "@softmaple/eslint-config/collaboration-layers";

export default [...config, ...egWalkerCollaborationConfig];
```

## Rules worth knowing

The base config turns two repo conventions into errors rather than review
comments:

- **`@typescript-eslint/no-explicit-any`** — `error`. Replace `any` with a real
  type; where that is genuinely infeasible, use `@ts-expect-error` with a
  reason, never `@ts-ignore`.
- **No TypeScript `enum`** — via `no-restricted-syntax` on
  `TSEnumDeclaration`. Use a const object plus a derived type; enums emit
  runtime code and defeat tree-shaking.

`eslint-plugin-only-warn` is loaded so lint output stays readable during
development; CI still fails on warnings because packages run
`eslint . --max-warnings=0`.

## Collaboration layering

[`collaboration-layers.js`](./collaboration-layers.js) is the mechanical half
of [`docs/design/collaboration-layers.md`](../../docs/design/collaboration-layers.md).
Each exported pattern set forbids the imports that would invert the layer
graph:

| Export | Forbids |
| --- | --- |
| `egWalkerCollaborationPatterns` | awareness, block model, bindings, protocol, runtime, editor frameworks |
| `blockModelCollaborationPatterns` | awareness, bindings, protocol, runtime, editor frameworks (EG-walker is allowed) |
| `blockModelBindingCollaborationPatterns` | awareness, protocol, runtime, and reaching past the block model into EG-walker (Lexical is allowed) |
| `collabProtocolCollaborationPatterns` | awareness, EG-walker, bindings, runtime, editor frameworks, host runtimes (the block model is allowed) |
| `collabRuntimeCollaborationPatterns` | everything outside a narrow allowlist — convergence internals, UI, concrete host runtimes (the protocol is allowed) |
| `egWalkerCollaborationConfig` | ready-to-spread flat config applying `egWalkerCollaborationPatterns` |
| `combinePatterns(...sets)` | composes pattern sets — flat config *replaces* a rule rather than merging it, so layering needs an explicit combine |

`@softmaple/awareness` enforces the equivalent rule through Biome's
`style/noRestrictedImports` instead, because it lints with Biome.

## Commands

```bash
pnpm --filter @softmaple/eslint-config test   # node:test over __tests__/
pnpm lint                                      # every workspace, via turbo
```
