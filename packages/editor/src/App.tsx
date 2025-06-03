import "./App.css";
import { CoreEditor } from "@softmaple/editor/components/core/CoreEditor.tsx";
import { Layout } from "@softmaple/editor/layout.tsx";
import { ThemeProvider } from "@softmaple/editor/context/theme-provider.tsx";
import { THEME_STORAGE_KEY } from "@softmaple/editor/constants/theme.ts";
import { useState, Suspense } from "react";
import type { LexicalEditor } from "lexical";

import { LazyExportFilesDropdownMenu } from "@softmaple/editor/components/core/ExportFiles/LazyExportFiles";

function App() {
  const [activeEditor, setActiveEditor] = useState<LexicalEditor>();

  return (
    <ThemeProvider defaultTheme="system" storageKey={THEME_STORAGE_KEY}>
      <Layout>
        <main className="container mx-auto py-10 px-4">
          <div className="flex justify-end mb-4">
            <Suspense
              fallback={
                <div className="h-8 w-20 bg-gray-200 animate-pulse rounded" />
              }
            >
              <LazyExportFilesDropdownMenu editor={activeEditor} />
            </Suspense>
          </div>

          <div className="max-w-4xl mx-auto">
            <CoreEditor
              activeEditor={activeEditor}
              setActiveEditor={setActiveEditor}
            />
          </div>
        </main>
      </Layout>
    </ThemeProvider>
  );
}

export default App;
