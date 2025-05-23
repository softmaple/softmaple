import "./App.css";
import { CoreEditor } from "@/components/core/CoreEditor.tsx";
import { Layout } from "@/layout.tsx";

function App() {
  return (
    <Layout>
      <main className="container mx-auto py-10 px-4">
        <div className="max-w-4xl mx-auto">
          <CoreEditor />
        </div>
      </main>
    </Layout>
  );
}

export default App;
