# `@softmaple/typescript-config`

Shared typescript configuration for the workspace.

Three presets, one strict base. A package's `tsconfig.json` extends one of
them and adds only what is genuinely local — paths, `include`, `outDir`.

## Architecture

```text
                                base.json
               strict · noUncheckedIndexedAccess · ES2022
            NodeNext modules · isolatedModules · declaration
                                    │
            ┌───────────────────────┼───────────────────────┐
            │                       │                       │
    extended directly      react-library.json          nextjs.json
            │               jsx: "react-jsx"      next plugin · ESNext
            │                       │            Bundler · jsx preserve
            │                       │                    noEmit
            │                       │                       │
        eg-walker                  ui                   apps/web
       block-model             playground
     binding-lexical
      collab-* · db
    md2latex · bench
    collab-cloudflare
```

## Usage

```jsonc
// packages/<name>/tsconfig.json
{
  "extends": "@softmaple/typescript-config/base.json",
  "compilerOptions": { "outDir": "dist" },
  "include": ["src"]
}
```

| Preset | For |
| --- | --- |
| `base.json` | Libraries and Node services — most of the repo |
| `react-library.json` | Base + `jsx: "react-jsx"` for React component sources |
| `nextjs.json` | Base + the `next` plugin, `Bundler` resolution, `jsx: "preserve"`, `noEmit` |

## Why the base is strict

`strict` and `noUncheckedIndexedAccess` are both on. The second one matters
most in the CRDT and block-model packages: array and map lookups there are
routinely out of range during replay, and an unchecked `arr[i]` typed as
non-`undefined` is exactly the bug class that produces a divergent document
rather than a crash.

`isolatedModules` keeps every file independently transpilable, which is what
lets `tsup`, Vite, Turbopack, and `wrangler` all consume the same sources.

Do not weaken these in a package-level override. If a preset genuinely does not
fit a new workspace, add a preset here rather than loosening one package.
