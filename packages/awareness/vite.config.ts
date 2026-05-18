import { fileURLToPath } from "url";
import path from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import dts from "vite-plugin-dts";
import tailwindcss from "@tailwindcss/vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
      "@softmaple/awareness": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    cssCodeSplit: true,
    lib: {
      cssFileName: "styles",
      entry: {
        index: path.resolve(__dirname, "src/index.ts"),
        styles: path.resolve(__dirname, "src/global.css"),
        "components/index": path.resolve(__dirname, "src/components/index.ts"),
        "components/activity-indicator": path.resolve(
          __dirname,
          "src/components/activity-indicator.tsx",
        ),
        "components/block-activity-indicator": path.resolve(
          __dirname,
          "src/components/block-activity-indicator.tsx",
        ),
        "components/live-cursor": path.resolve(
          __dirname,
          "src/components/live-cursor.tsx",
        ),
        "components/presence-avatar": path.resolve(
          __dirname,
          "src/components/presence-avatar.tsx",
        ),
        "components/presence-bar": path.resolve(
          __dirname,
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
          __dirname,
          "src/components/presence-layer.tsx",
        ),
        "components/selection-highlight": path.resolve(
          __dirname,
          "src/components/selection-highlight.tsx",
        ),
        "utils/textarea-rects": path.resolve(
          __dirname,
          "src/utils/textarea-rects.ts",
        ),
        "mapping/index": path.resolve(__dirname, "src/mapping/index.ts"),
        "testing/index": path.resolve(__dirname, "src/testing/index.ts"),
        "hooks/index": path.resolve(__dirname, "src/hooks/index.ts"),
        "adapters/index": path.resolve(__dirname, "src/adapters/index.ts"),
        "state/index": path.resolve(__dirname, "src/state/index.ts"),
        "types/presence": path.resolve(__dirname, "src/types/presence.ts"),
        "types/events": path.resolve(__dirname, "src/types/events.ts"),
        "types/state": path.resolve(__dirname, "src/types/state.ts"),
        "adapters/types": path.resolve(__dirname, "src/adapters/types.ts"),
        "adapters/broadcast-channel/index": path.resolve(
          __dirname,
          "src/adapters/broadcast-channel/index.ts",
        ),
        "adapters/websocket/index": path.resolve(
          __dirname,
          "src/adapters/websocket/index.ts",
        ),
        "adapters/noop/index": path.resolve(
          __dirname,
          "src/adapters/noop/index.ts",
        ),
        "providers/index": path.resolve(__dirname, "src/providers/index.ts"),
        "providers/presence-context": path.resolve(
          __dirname,
          "src/providers/presence-context.ts",
        ),
        "providers/presence-provider": path.resolve(
          __dirname,
          "src/providers/presence-provider.tsx",
        ),
        "hooks/use-presence": path.resolve(__dirname, "src/hooks/use-presence.ts"),
        "hooks/use-self": path.resolve(__dirname, "src/hooks/use-self.ts"),
        "hooks/use-others": path.resolve(__dirname, "src/hooks/use-others.ts"),
        "hooks/use-connection": path.resolve(__dirname, "src/hooks/use-connection.ts"),
        "hooks/use-update-presence": path.resolve(
          __dirname,
          "src/hooks/use-update-presence.ts",
        ),
        "hooks/use-update-typing": path.resolve(
          __dirname,
          "src/hooks/use-update-typing.ts",
        ),
        "hooks/use-activity": path.resolve(__dirname, "src/hooks/use-activity.ts"),
        "hooks/use-presence-cursors": path.resolve(
          __dirname,
          "src/hooks/use-presence-cursors.ts",
        ),
        "hooks/use-peers-in-block": path.resolve(
          __dirname,
          "src/hooks/use-peers-in-block.ts",
        ),
        "hooks/use-textarea-selection-sync": path.resolve(
          __dirname,
          "src/hooks/use-textarea-selection-sync.ts",
        ),
        "bindings/textarea/index": path.resolve(
          __dirname,
          "src/bindings/textarea/index.ts",
        ),
      },
      formats: ["es"],
      fileName: (format, entryName) => `${entryName}.js`,
    },
    rollupOptions: {
      external: ["react", "react-dom", "react/jsx-runtime"],
      output: {
        preserveModules: false,
      },
    },
    sourcemap: true,
    minify: false,
  },
});
