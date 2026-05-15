import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import viteTsConfigPaths from "vite-tsconfig-paths";
import tailwindcss from "@tailwindcss/vite";
import { nitro } from "nitro/vite";

const fromHere = (p: string) =>
  fileURLToPath(new URL(p, import.meta.url));

// Workspace packages have a `package.json#exports` pointing to `./dist`,
// but for the playground we resolve them straight to source so a fresh
// clone never has to build dependent packages before running tests, dev,
// or build. `resolve.alias` wins ahead of plugin-based resolution, which
// is what we need to bypass Vitest's prebundler too.
const workspaceAlias = {
  "@softmaple/awareness/styles.css": fromHere(
    "../../packages/awareness/src/global.css",
  ),
  "@softmaple/awareness": fromHere("../../packages/awareness/src/index.ts"),
  "@softmaple/eg-walker": fromHere("../../packages/eg-walker/src/index.ts"),
};

const config = defineConfig(({ mode }) => ({
  resolve: {
    alias: workspaceAlias,
  },
  plugins: [
    // Only load dev tools and nitro in non-test mode to prevent hanging processes
    ...(mode !== "test" ? [devtools(), nitro()] : []),
    // this is the plugin that enables path aliases
    viteTsConfigPaths({
      projects: ["./tsconfig.json"],
    }),
    tailwindcss(),
    ...(mode !== "test" ? [tanstackStart()] : []),
    viteReact(),
  ],
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts",
    exclude: ["**/node_modules/**", "**/dist/**", "**/e2e/**"],
  },
}));

export default config;
