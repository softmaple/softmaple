import "./App.css";
import { CoreEditor } from "@softmaple/editor/components/core/CoreEditor.tsx";
import { Layout } from "@softmaple/editor/layout.tsx";
import { ThemeProvider } from "@softmaple/editor/context/theme-provider.tsx";
import { THEME_STORAGE_KEY } from "@softmaple/editor/constants/theme.ts";

function App() {
  return (
    <ThemeProvider defaultTheme="system" storageKey={THEME_STORAGE_KEY}>
      <Layout>
        <main className="container mx-auto py-10 px-4">
          <div className="max-w-4xl mx-auto">
            <CoreEditor />
          </div>
        </main>
      </Layout>
    </ThemeProvider>
  );
}

export default App;
