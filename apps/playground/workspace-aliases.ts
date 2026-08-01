import * as path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Workspace package aliases for the playground.
 *
 * `@softmaple/awareness` and `@softmaple/eg-walker` ship a
 * `package.json#exports` pointing to `./dist`, which means a fresh clone
 * normally needs `pnpm --filter <pkg> build` before the playground can
 * resolve them. For local DX (and for Vercel cold builds) we resolve
 * straight to source instead, so dev / build / typecheck / test all work
 * with no upstream build step.
 *
 * Imported by both `vite.config.ts` (covers dev, build, SSR, preview)
 * and `vitest.config.ts` (covers test runs — vitest reads its own config
 * file and does not inherit vite.config). The matching TS path mappings
 * live in `tsconfig.json#paths` for `tsc --noEmit`.
 *
 * Order matters: keep the more-specific `/styles.css` entry before the
 * bare package alias so the CSS subpath wins.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const fromPlayground = (p: string) => path.resolve(here, p);

export const workspaceAlias: Readonly<Record<string, string>> = {
  "@softmaple/binding-lexical/react": fromPlayground(
    "../../packages/binding-lexical/src/react.tsx",
  ),
  "@softmaple/binding-lexical": fromPlayground(
    "../../packages/binding-lexical/src/index.ts",
  ),
  "@softmaple/block-model": fromPlayground(
    "../../packages/block-model/src/index.ts",
  ),
  "@softmaple/editor": fromPlayground("../../packages/editor/src"),
  "@softmaple/ui": fromPlayground("../../packages/ui/src"),
  "@softmaple/awareness/styles.css": fromPlayground(
    "../../packages/awareness/src/global.css",
  ),
  "@softmaple/awareness/bindings/textarea": fromPlayground(
    "../../packages/awareness/src/bindings/textarea/index.ts",
  ),
  "@softmaple/awareness/mapping": fromPlayground(
    "../../packages/awareness/src/mapping/index.ts",
  ),
  "@softmaple/awareness/hooks": fromPlayground(
    "../../packages/awareness/src/hooks/index.ts",
  ),
  "@softmaple/awareness": fromPlayground(
    "../../packages/awareness/src/index.ts",
  ),
  "@softmaple/eg-walker/anchors": fromPlayground(
    "../../packages/eg-walker/src/anchors.ts",
  ),
  "@softmaple/eg-walker": fromPlayground(
    "../../packages/eg-walker/src/index.ts",
  ),
};
