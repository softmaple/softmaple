import "./App.css";
import { CoreEditor } from "@/components/core/CoreEditor.tsx";

function App() {
  return (
    <main className="container mx-auto py-10 px-4">
      <div className="max-w-4xl mx-auto">
        <CoreEditor />
      </div>
    </main>
  );
}

export default App;
