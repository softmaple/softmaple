import path from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import dts from "vite-plugin-dts";
import tailwindcss from "@tailwindcss/vite";

const rootDir = import.meta.dirname;

export default defineConfig({
  plugins: [
    react(),
    dts({
      insertTypesEntry: false,
      include: ["src"],
      exclude: ["src/**/*.test.ts", "src/**/*.test.tsx", "src/test/**"],
    }),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      "@softmaple/awareness": path.resolve(rootDir, "./src"),
    },
  },
  build: {
    cssCodeSplit: true,
    lib: {
      cssFileName: "styles",
      entry: {
        index: path.resolve(rootDir, "src/index.ts"),
        styles: path.resolve(rootDir, "src/global.css"),
        "components/index": path.resolve(rootDir, "src/components/index.ts"),
        "components/activity-indicator": path.resolve(
          rootDir,
          "src/components/activity-indicator.tsx",
        ),
        "components/block-activity-indicator": path.resolve(
          rootDir,
          "src/components/block-activity-indicator.tsx",
        ),
        "components/live-cursor": path.resolve(
          rootDir,
          "src/components/live-cursor.tsx",
        ),
        "components/presence-avatar": path.resolve(
          rootDir,
          "src/components/presence-avatar.tsx",
        ),
        "components/presence-bar": path.resolve(
          rootDir,
          "src/components/presence-bar.tsx",
        ),
        // `components/presence-layer` is a build entry primarily for
        // module deduping: both the main entry and `./testing` import
        // `PresenceLayerContext` from this module, and splitting it as
        // its own chunk keeps a single module instance shared across
        // those entries (and the public `./components/presence-layer`
        // subpath, which `package.json#exports` does expose). Without
        // this entry, Vite would inline the module into each consumer
        // and consumers would see two different context identities (a
        // `<PresenceLayer>` provider would be invisible to a
        // `useContext(PresenceLayerContext)` read from the testing
        // entry).
        "components/presence-layer": path.resolve(
          rootDir,
          "src/components/presence-layer.tsx",
        ),
        "components/selection-highlight": path.resolve(
          rootDir,
          "src/components/selection-highlight.tsx",
        ),
        "utils/textarea-rects": path.resolve(
          rootDir,
          "src/utils/textarea-rects.ts",
        ),
        "mapping/index": path.resolve(rootDir, "src/mapping/index.ts"),
        "protocol/index": path.resolve(rootDir, "src/protocol/index.ts"),
        "testing/index": path.resolve(rootDir, "src/testing/index.ts"),
        "hooks/index": path.resolve(rootDir, "src/hooks/index.ts"),
        "adapters/index": path.resolve(rootDir, "src/adapters/index.ts"),
        "state/index": path.resolve(rootDir, "src/state/index.ts"),
        "types/presence": path.resolve(rootDir, "src/types/presence.ts"),
        "types/events": path.resolve(rootDir, "src/types/events.ts"),
        "types/state": path.resolve(rootDir, "src/types/state.ts"),
        "adapters/types": path.resolve(rootDir, "src/adapters/types.ts"),
        "adapters/broadcast-channel/index": path.resolve(
          rootDir,
          "src/adapters/broadcast-channel/index.ts",
        ),
        "adapters/websocket/index": path.resolve(
          rootDir,
          "src/adapters/websocket/index.ts",
        ),
        "adapters/noop/index": path.resolve(
          rootDir,
          "src/adapters/noop/index.ts",
        ),
        "providers/index": path.resolve(rootDir, "src/providers/index.ts"),
        "providers/presence-context": path.resolve(
          rootDir,
          "src/providers/presence-context.ts",
        ),
        "providers/presence-provider": path.resolve(
          rootDir,
          "src/providers/presence-provider.tsx",
        ),
        "hooks/use-presence": path.resolve(
          rootDir,
          "src/hooks/use-presence.ts",
        ),
        "hooks/use-self": path.resolve(rootDir, "src/hooks/use-self.ts"),
        "hooks/use-others": path.resolve(rootDir, "src/hooks/use-others.ts"),
        "hooks/use-connection": path.resolve(
          rootDir,
          "src/hooks/use-connection.ts",
        ),
        "hooks/use-update-presence": path.resolve(
          rootDir,
          "src/hooks/use-update-presence.ts",
        ),
        "hooks/use-update-typing": path.resolve(
          rootDir,
          "src/hooks/use-update-typing.ts",
        ),
        "hooks/use-activity": path.resolve(
          rootDir,
          "src/hooks/use-activity.ts",
        ),
        "hooks/use-presence-cursors": path.resolve(
          rootDir,
          "src/hooks/use-presence-cursors.ts",
        ),
        "hooks/use-peers-in-block": path.resolve(
          rootDir,
          "src/hooks/use-peers-in-block.ts",
        ),
        "hooks/use-textarea-selection-sync": path.resolve(
          rootDir,
          "src/hooks/use-textarea-selection-sync.ts",
        ),
        "bindings/textarea/index": path.resolve(
          rootDir,
          "src/bindings/textarea/index.ts",
        ),
      },
      formats: ["es"],
      fileName: (format, entryName) => `${entryName}.js`,
    },
    rolldownOptions: {
      external: ["react", "react-dom", "react/jsx-runtime"],
      output: {
        preserveModules: false,
      },
    },
    sourcemap: true,
    minify: false,
  },
});
