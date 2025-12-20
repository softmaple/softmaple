import { createFileRoute } from "@tanstack/react-router";
import { useState, useCallback } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@softmaple/ui/components/card";
import { Textarea } from "@softmaple/ui/components/textarea";
import { EgWalkerAPI } from "@softmaple/eg-walker";

export const Route = createFileRoute("/demo/collaborative-editor")({
  component: CollaborativeEditor,
});

function CollaborativeEditor() {
  const [replica1Text, setReplica1Text] = useState("");
  const [replica2Text, setReplica2Text] = useState("");
  const [api1] = useState(() => new EgWalkerAPI("replica-1"));
  const [api2] = useState(() => new EgWalkerAPI("replica-2"));

  const handleReplica1Change = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newText = e.target.value;
      const oldText = replica1Text;

      // Simple diff: find the change and apply it
      if (newText.length > oldText.length) {
        // Insertion
        const insertPos = findInsertPosition(oldText, newText);
        const insertedText = newText.slice(
          insertPos,
          insertPos + (newText.length - oldText.length),
        );
        api1.insert(insertPos, insertedText);

        // Sync to replica 2 (simulate network sync)
        // In real app, events would be sent over network
        setReplica2Text(api2.getText());
      } else if (newText.length < oldText.length) {
        // Deletion
        const deletePos = findDeletePosition(oldText, newText);
        const deleteCount = oldText.length - newText.length;
        api1.delete(deletePos, deleteCount);

        // Sync to replica 2 (simulate network sync)
        setReplica2Text(api2.getText());
      }

      setReplica1Text(newText);
    },
    [replica1Text, api1, api2],
  );

  const handleReplica2Change = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newText = e.target.value;
      const oldText = replica2Text;

      // Simple diff: find the change and apply it
      if (newText.length > oldText.length) {
        // Insertion
        const insertPos = findInsertPosition(oldText, newText);
        const insertedText = newText.slice(
          insertPos,
          insertPos + (newText.length - oldText.length),
        );
        api2.insert(insertPos, insertedText);

        // Sync to replica 1 (simulate network sync)
        setReplica1Text(api1.getText());
      } else if (newText.length < oldText.length) {
        // Deletion
        const deletePos = findDeletePosition(oldText, newText);
        const deleteCount = oldText.length - newText.length;
        api2.delete(deletePos, deleteCount);

        // Sync to replica 1 (simulate network sync)
        setReplica1Text(api1.getText());
      }

      setReplica2Text(newText);
    },
    [replica2Text, api1, api2],
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

// Helper function to find where text was inserted
const findInsertPosition = (oldText: string, newText: string): number => {
  for (let i = 0; i < Math.min(oldText.length, newText.length); i++) {
    if (oldText[i] !== newText[i]) {
      return i;
    }
  }
  return oldText.length;
};

// Helper function to find where text was deleted
const findDeletePosition = (oldText: string, newText: string): number => {
  for (let i = 0; i < Math.min(oldText.length, newText.length); i++) {
    if (oldText[i] !== newText[i]) {
      return i;
    }
  }
  return newText.length;
};
