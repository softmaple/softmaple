import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import dts from "vite-plugin-dts";
import path from "path";

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
