import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@softmaple/editor": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          // Split React and React DOM into a separate chunk
          "vendor-react": ["react", "react-dom"],
          // Split Lexical editor related packages (submodules only)
          lexical: [
            "lexical",
            "@lexical/rich-text",
            "@lexical/list",
            "@lexical/code",
            "@lexical/link",
            "@lexical/markdown",
            "@lexical/selection",
            "@lexical/table",
            "@lexical/utils",
            // Submodules used from @lexical/react
            "@lexical/react/LexicalComposer",
            "@lexical/react/LexicalRichTextPlugin",
            "@lexical/react/LexicalErrorBoundary",
            "@lexical/react/LexicalContentEditable",
            "@lexical/react/LexicalListPlugin",
            "@lexical/react/LexicalCheckListPlugin",
            "@lexical/react/LexicalHistoryPlugin",
            "@lexical/react/LexicalComposerContext",
            "@lexical/react/LexicalMarkdownShortcutPlugin",
          ],
          // Split utility libraries
          utils: ["clsx", "tailwind-merge", "class-variance-authority"],

          ui: ["lucide-react"],

          "toolbar-components": [
            "./src/components/core/plugins/ToolbarPlugin/FormatButtonGroup",
            "./src/components/core/plugins/ToolbarPlugin/HistoryButtonGroup",
            "./src/components/core/plugins/ToolbarPlugin/BlockFormatDropdown",
          ],

          "export-features": [
            "./src/components/core/ExportFiles/ExportFilesDropdownMenu",
          ],

          "editor-plugins": [
            "./src/components/core/plugins/ShortcutsPlugin/ShortcutsPlugin",
            "./src/components/core/plugins/MarkdownShortcutPlugin/MarkdownShortcutPlugin",
            "./src/components/core/plugins/MarkdownTransformers/MarkdownTransformers",
          ],
        },
      },
    },
  },
});
