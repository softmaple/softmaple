import { fileURLToPath } from "url";
import path from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import dts from "vite-plugin-dts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [
    react(),
    dts({
      insertTypesEntry: false,
      include: ["src"],
      exclude: ["src/**/*.test.ts", "src/**/*.test.tsx", "src/test/**"],
    }),
  ],
  resolve: {
    alias: {
      "@softmaple/awareness": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    lib: {
      entry: {
        "types/presence": path.resolve(__dirname, "src/types/presence.ts"),
        "types/events": path.resolve(__dirname, "src/types/events.ts"),
        "types/state": path.resolve(__dirname, "src/types/state.ts"),
        "adapters/types": path.resolve(__dirname, "src/adapters/types.ts"),
        "adapters/broadcast-channel": path.resolve(__dirname, "src/adapters/broadcast-channel.ts"),
        "adapters/websocket": path.resolve(__dirname, "src/adapters/websocket.ts"),
        "providers/presence-context": path.resolve(__dirname, "src/providers/presence-context.ts"),
        "providers/presence-provider": path.resolve(__dirname, "src/providers/presence-provider.tsx"),
        "hooks/use-presence": path.resolve(__dirname, "src/hooks/use-presence.ts"),
        "hooks/use-self": path.resolve(__dirname, "src/hooks/use-self.ts"),
        "hooks/use-others": path.resolve(__dirname, "src/hooks/use-others.ts"),
        "hooks/use-connection": path.resolve(__dirname, "src/hooks/use-connection.ts"),
        "hooks/use-update-presence": path.resolve(__dirname, "src/hooks/use-update-presence.ts"),
        "hooks/use-activity": path.resolve(__dirname, "src/hooks/use-activity.ts"),
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
