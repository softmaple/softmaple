import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@softmaple/ui/components/card";
import { Textarea } from "@softmaple/ui/components/textarea";

export const Route = createFileRoute("/demo/collaborative-editor")({
  component: CollaborativeEditor,
});

function CollaborativeEditor() {
  const [replica1Text, setReplica1Text] = useState("");
  const [replica2Text, setReplica2Text] = useState("");

  const handleReplica1Change = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newText = e.target.value;
      setReplica1Text(newText);
      setReplica2Text(newText);
    },
    [],
  );

  const handleReplica2Change = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newText = e.target.value;
      setReplica2Text(newText);
      setReplica1Text(newText);
    },
    [],
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-900 via-blue-900 to-indigo-900 text-white p-8">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-4xl font-bold mb-8 text-center">
          Collaborative Text Editor
        </h1>
        <p className="text-center text-white/70 mb-8">
          Powered by <strong>Eg-Walker CRDT Algorithm</strong>. Type in either
          editor to see real-time synchronization.
        </p>

        {/* Two-panel layout: side-by-side on desktop, stacked on mobile */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Replica 1 */}
          <Card className="flex flex-col h-full bg-white/10 backdrop-blur-md border-white/20 shadow-xl gap-0 py-0">
            <CardHeader className="bg-white/5 border-b border-white/20 px-4 py-3">
              <CardTitle id="replica-1-label" className="text-xl text-white">
                Replica 1
              </CardTitle>
            </CardHeader>
            <CardContent className="flex-1 p-0">
              <Textarea
                data-testid="replica-1"
                value={replica1Text}
                onChange={handleReplica1Change}
                placeholder="Start typing in Replica 1..."
                aria-labelledby="replica-1-label"
                className="h-full w-full min-h-[400px] lg:min-h-[600px] resize-none bg-transparent text-white placeholder-white/40 focus-visible:ring-2 focus-visible:ring-blue-400 border-0 rounded-none p-4"
              />
            </CardContent>
          </Card>

          {/* Replica 2 */}
          <Card className="flex flex-col h-full bg-white/10 backdrop-blur-md border-white/20 shadow-xl gap-0 py-0">
            <CardHeader className="bg-white/5 border-b border-white/20 px-4 py-3">
              <CardTitle id="replica-2-label" className="text-xl text-white">
                Replica 2
              </CardTitle>
            </CardHeader>
            <CardContent className="flex-1 p-0">
              <Textarea
                data-testid="replica-2"
                value={replica2Text}
                onChange={handleReplica2Change}
                placeholder="Start typing in Replica 2..."
                aria-labelledby="replica-2-label"
                className="h-full w-full min-h-[400px] lg:min-h-[600px] resize-none bg-transparent text-white placeholder-white/40 focus-visible:ring-2 focus-visible:ring-green-400 border-0 rounded-none p-4"
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

export default CollaborativeEditor;
