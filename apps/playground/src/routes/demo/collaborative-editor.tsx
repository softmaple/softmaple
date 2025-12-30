import { createFileRoute } from "@tanstack/react-router";
import { useState, useCallback, useRef } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@softmaple/ui/components/card";
import { EgWalkerAPI } from "@softmaple/eg-walker";
import {
  findInsertPosition,
  findDeletePosition,
  findDifferingRange,
} from "@/lib/text-diff";

export const Route = createFileRoute("/demo/collaborative-editor")({
  component: CollaborativeEditor,
});

function CollaborativeEditor() {
  const [replica1Text, setReplica1Text] = useState("");
  const [replica2Text, setReplica2Text] = useState("");
  const [api1] = useState(() => new EgWalkerAPI("replica-1"));
  const [api2] = useState(() => new EgWalkerAPI("replica-2"));
  const replica1Ref = useRef<HTMLTextAreaElement>(null);
  const replica2Ref = useRef<HTMLTextAreaElement>(null);

  const handleReplica1Change = useCallback(
    async (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newText = e.target.value;
      const oldText = api1.getText();

      if (newText.length > oldText.length) {
        // Insertion
        const insertPos = findInsertPosition(oldText, newText);
        const insertedText = newText.slice(
          insertPos,
          insertPos + (newText.length - oldText.length),
        );
        const expectedCursorPos = insertPos + insertedText.length;

        api1.insert(insertPos, insertedText);

        // Get the latest event from replica1 and propagate to replica2 asynchronously
        const events = api1.exportEventGraph();
        const latestEvent = events[events.length - 1];
        if (latestEvent) {
          try {
            await api2.applyRemoteEvent(latestEvent);
            setReplica2Text(api2.getText());
          } catch (error) {
            console.error("Failed to sync insert to replica2:", error);
          }
        }

        // Update local state and preserve cursor position after insertion
        setReplica1Text(api1.getText());
        setTimeout(() => {
          if (replica1Ref.current) {
            replica1Ref.current.setSelectionRange(
              expectedCursorPos,
              expectedCursorPos,
            );
          }
        }, 0);
        return;
      } else if (newText.length < oldText.length) {
        // Deletion
        const deletePos = findDeletePosition(oldText, newText);
        const deleteCount = oldText.length - newText.length;
        const expectedCursorPos = deletePos;

        api1.delete(deletePos, deleteCount);

        // Get the latest event from replica1 and propagate to replica2 asynchronously
        const events = api1.exportEventGraph();
        const latestEvent = events[events.length - 1];
        if (latestEvent) {
          try {
            await api2.applyRemoteEvent(latestEvent);
            setReplica2Text(api2.getText());
          } catch (error) {
            console.error("Failed to sync delete to replica2:", error);
          }
        }

        // Update local state and restore cursor position
        setReplica1Text(api1.getText());
        // Use setTimeout to ensure cursor restoration happens after React re-render
        setTimeout(() => {
          if (replica1Ref.current) {
            replica1Ref.current.setSelectionRange(
              expectedCursorPos,
              expectedCursorPos,
            );
          }
        }, 0);
        return; // Early return to avoid duplicate state updates at the end
      } else if (newText.length === oldText.length && newText !== oldText) {
        // Replacement (same length, different content)
        const { start, end } = findDifferingRange(oldText, newText);
        const deleteCount = end - start + 1;
        const replacementText = newText.slice(start, end + 1);
        const expectedCursorPos = end + 1;

        // Perform delete then insert
        api1.delete(start, deleteCount);
        api1.insert(start, replacementText);

        // Get the latest two events (delete + insert) and propagate to replica2 asynchronously
        const events = api1.exportEventGraph();
        const latestEvents = events.slice(-2);
        try {
          for (const event of latestEvents) {
            await api2.applyRemoteEvent(event);
          }
          setReplica2Text(api2.getText());
        } catch (error) {
          console.error("Failed to sync replacement to replica2:", error);
        }

        // Update local state and preserve cursor position
        setReplica1Text(api1.getText());
        setTimeout(() => {
          if (replica1Ref.current) {
            replica1Ref.current.setSelectionRange(
              expectedCursorPos,
              expectedCursorPos,
            );
          }
        }, 0);
        return;
      }

      // Sync local state with API's getText() to ensure consistency
      setReplica1Text(api1.getText());
      setReplica2Text(api2.getText());
    },
    [api1, api2, replica1Ref],
  );

  const handleReplica2Change = useCallback(
    async (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newText = e.target.value;
      const oldText = api2.getText();

      if (newText.length > oldText.length) {
        // Insertion
        const insertPos = findInsertPosition(oldText, newText);
        const insertedText = newText.slice(
          insertPos,
          insertPos + (newText.length - oldText.length),
        );
        const expectedCursorPos = insertPos + insertedText.length;

        api2.insert(insertPos, insertedText);

        // Get the latest event from replica2 and propagate to replica1 asynchronously
        const events = api2.exportEventGraph();
        const latestEvent = events[events.length - 1];
        if (latestEvent) {
          try {
            await api1.applyRemoteEvent(latestEvent);
            setReplica1Text(api1.getText());
          } catch (error) {
            console.error("Failed to sync insert to replica1:", error);
          }
        }

        // Update local state and preserve cursor position after insertion
        setReplica2Text(api2.getText());
        setTimeout(() => {
          if (replica2Ref.current) {
            replica2Ref.current.setSelectionRange(
              expectedCursorPos,
              expectedCursorPos,
            );
          }
        }, 0);
        return;
      } else if (newText.length < oldText.length) {
        // Deletion
        const deletePos = findDeletePosition(oldText, newText);
        const deleteCount = oldText.length - newText.length;
        const expectedCursorPos = deletePos;

        api2.delete(deletePos, deleteCount);

        // Get the latest event from replica2 and propagate to replica1 asynchronously
        const events = api2.exportEventGraph();
        const latestEvent = events[events.length - 1];
        if (latestEvent) {
          try {
            await api1.applyRemoteEvent(latestEvent);
            setReplica1Text(api1.getText());
          } catch (error) {
            console.error("Failed to sync delete to replica1:", error);
          }
        }

        // Update local state and restore cursor position
        setReplica2Text(api2.getText());
        // Use setTimeout to ensure cursor restoration happens after React re-render
        setTimeout(() => {
          if (replica2Ref.current) {
            replica2Ref.current.setSelectionRange(
              expectedCursorPos,
              expectedCursorPos,
            );
          }
        }, 0);
        return; // Early return to avoid duplicate state updates at the end
      } else if (newText.length === oldText.length && newText !== oldText) {
        // Replacement (same length, different content)
        const { start, end } = findDifferingRange(oldText, newText);
        const deleteCount = end - start + 1;
        const replacementText = newText.slice(start, end + 1);
        const expectedCursorPos = end + 1;

        // Perform delete then insert
        api2.delete(start, deleteCount);
        api2.insert(start, replacementText);

        // Get the latest two events (delete + insert) and propagate to replica1 asynchronously
        const events = api2.exportEventGraph();
        const latestEvents = events.slice(-2);
        try {
          for (const event of latestEvents) {
            await api1.applyRemoteEvent(event);
          }
          setReplica1Text(api1.getText());
        } catch (error) {
          console.error("Failed to sync replacement to replica1:", error);
        }

        // Update local state and preserve cursor position
        setReplica2Text(api2.getText());
        setTimeout(() => {
          if (replica2Ref.current) {
            replica2Ref.current.setSelectionRange(
              expectedCursorPos,
              expectedCursorPos,
            );
          }
        }, 0);
        return;
      }

      // Sync local state with API's getText() to ensure consistency
      setReplica2Text(api2.getText());
      setReplica1Text(api1.getText());
    },
    [api1, api2, replica2Ref],
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
              <textarea
                ref={replica1Ref}
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
              <textarea
                ref={replica2Ref}
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
