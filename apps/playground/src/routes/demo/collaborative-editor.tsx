import { createFileRoute } from "@tanstack/react-router";
import { useState, useCallback, useEffect } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@softmaple/ui/components/card";
import { Textarea } from "@softmaple/ui/components/textarea";
import { EgWalkerAPI, type GraphEvent } from "@softmaple/eg-walker";
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
  const [pendingEvents, setPendingEvents] = useState<
    {
      source: "replica1" | "replica2";
      events: GraphEvent[];
    }[]
  >([]);

  // Process pending events to sync between replicas
  useEffect(() => {
    const processPendingEvents = async () => {
      for (const { source, events } of pendingEvents) {
        for (const event of events) {
          if (source === "replica1") {
            // Apply event from replica1 to replica2
            await api2.applyRemoteEvent(event);
            setReplica2Text(api2.getText());
          } else {
            // Apply event from replica2 to replica1
            await api1.applyRemoteEvent(event);
            setReplica1Text(api1.getText());
          }
        }
      }
      // Clear processed events
      if (pendingEvents.length > 0) {
        setPendingEvents([]);
      }
    };

    processPendingEvents();
  }, [pendingEvents, api1, api2]);

  const handleReplica1Change = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newText = e.target.value;
      const oldText = replica1Text;

      if (newText.length > oldText.length) {
        // Insertion
        const insertPos = findInsertPosition(oldText, newText);
        const insertedText = newText.slice(
          insertPos,
          insertPos + (newText.length - oldText.length),
        );
        api1.insert(insertPos, insertedText);

        // Get the latest event from replica1 and queue it for replica2
        const events = api1.exportEventGraph();
        const latestEvent = events[events.length - 1];
        if (latestEvent) {
          setPendingEvents((prev) => [
            ...prev,
            { source: "replica1", events: [latestEvent] },
          ]);
        }
      } else if (newText.length < oldText.length) {
        // Deletion
        const deletePos = findDeletePosition(oldText, newText);
        const deleteCount = oldText.length - newText.length;
        api1.delete(deletePos, deleteCount);

        // Get the latest event from replica1 and queue it for replica2
        const events = api1.exportEventGraph();
        const latestEvent = events[events.length - 1];
        if (latestEvent) {
          setPendingEvents((prev) => [
            ...prev,
            { source: "replica1", events: [latestEvent] },
          ]);
        }
      } else if (newText.length === oldText.length && newText !== oldText) {
        // Replacement (same length, different content)
        const { start, end } = findDifferingRange(oldText, newText);
        const deleteCount = end - start + 1;
        const replacementText = newText.slice(start, end + 1);

        // Perform delete then insert
        api1.delete(start, deleteCount);
        api1.insert(start, replacementText);

        // Get the latest two events (delete + insert) and queue them
        const events = api1.exportEventGraph();
        const latestEvents = events.slice(-2);
        if (latestEvents.length > 0) {
          setPendingEvents((prev) => [
            ...prev,
            { source: "replica1", events: latestEvents },
          ]);
        }
      }

      setReplica1Text(newText);
    },
    [replica1Text, api1],
  );

  const handleReplica2Change = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newText = e.target.value;
      const oldText = replica2Text;

      if (newText.length > oldText.length) {
        // Insertion
        const insertPos = findInsertPosition(oldText, newText);
        const insertedText = newText.slice(
          insertPos,
          insertPos + (newText.length - oldText.length),
        );
        api2.insert(insertPos, insertedText);

        // Get the latest event from replica2 and queue it for replica1
        const events = api2.exportEventGraph();
        const latestEvent = events[events.length - 1];
        if (latestEvent) {
          setPendingEvents((prev) => [
            ...prev,
            { source: "replica2", events: [latestEvent] },
          ]);
        }
      } else if (newText.length < oldText.length) {
        // Deletion
        const deletePos = findDeletePosition(oldText, newText);
        const deleteCount = oldText.length - newText.length;
        api2.delete(deletePos, deleteCount);

        // Get the latest event from replica2 and queue it for replica1
        const events = api2.exportEventGraph();
        const latestEvent = events[events.length - 1];
        if (latestEvent) {
          setPendingEvents((prev) => [
            ...prev,
            { source: "replica2", events: [latestEvent] },
          ]);
        }
      } else if (newText.length === oldText.length && newText !== oldText) {
        // Replacement (same length, different content)
        const { start, end } = findDifferingRange(oldText, newText);
        const deleteCount = end - start + 1;
        const replacementText = newText.slice(start, end + 1);

        // Perform delete then insert
        api2.delete(start, deleteCount);
        api2.insert(start, replacementText);

        // Get the latest two events (delete + insert) and queue them
        const events = api2.exportEventGraph();
        const latestEvents = events.slice(-2);
        if (latestEvents.length > 0) {
          setPendingEvents((prev) => [
            ...prev,
            { source: "replica2", events: latestEvents },
          ]);
        }
      }

      setReplica2Text(newText);
    },
    [replica2Text, api2],
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
