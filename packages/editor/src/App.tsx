import "./App.css";
import { CoreEditor } from "@/components/core/CoreEditor.tsx";
import { Layout } from "@/layout.tsx";
import { ThemeProvider } from "@/context/theme-provider.tsx";
import { THEME_STORAGE_KEY } from "@/constants/theme.ts";

function App() {
  return (
    <ThemeProvider defaultTheme="dark" storageKey={THEME_STORAGE_KEY}>
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
