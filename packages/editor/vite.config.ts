import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@softmaple/editor": path.resolve(import.meta.dirname, "./src"),
    },
  },
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: "vendor-react",
              test: /node_modules\/(?:react|react-dom)\//,
            },
            {
              name: "lexical",
              test: /node_modules\/(?:lexical|@lexical)\//,
            },
            {
              name: "utils",
              test: /node_modules\/(?:clsx|tailwind-merge|class-variance-authority|lucide-react)\//,
            },
          ],
        },
      },
    },
  },
});
