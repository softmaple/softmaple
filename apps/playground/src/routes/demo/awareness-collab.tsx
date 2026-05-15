import { EgWalkerReplica } from "@softmaple/eg-walker";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { AwarenessOverlay } from "@/components/awareness-collab/AwarenessOverlay";
import { EditorSurface } from "@/components/awareness-collab/EditorSurface";
import { TrainerPicker } from "@/components/awareness-collab/TrainerPicker";
import {
  findDeletePosition,
  findDifferingRange,
  findInsertPosition,
} from "@/lib/text-diff";
import { useAwarenessAdapter } from "@/modules/awareness-collab/use-awareness-adapter";

export const Route = createFileRoute("/demo/awareness-collab")({
  component: AwarenessCollabDemo,
});

const ROOM_ID = "awareness-collab-demo";
const SYNC_CHANNEL = `eg-walker-sync:${ROOM_ID}`;

function AwarenessCollabDemo() {
  const [trainer, setTrainer] = useState<string | null>(null);

  if (!trainer) {
    return <TrainerPicker onSelect={setTrainer} />;
  }

  return <CollabSession trainerId={trainer} onLeave={() => setTrainer(null)} />;
}

interface SyncMessage {
  readonly type: "eg-walker-event";
  readonly senderId: string;
  readonly event: unknown;
}

function CollabSession({
  trainerId,
  onLeave,
}: {
  readonly trainerId: string;
  readonly onLeave: () => void;
}) {
  const { adapter, userInfo } = useAwarenessAdapter(trainerId, ROOM_ID);
  const [replica] = useState(() => new EgWalkerReplica(userInfo.userId, ""));
  const [text, setText] = useState("");
  const broadcastRef = useRef<BroadcastChannel | null>(null);
  const lastSentEventCountRef = useRef(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Separate BroadcastChannel for CRDT event sync. Awareness adapter
  // already opens its own channel for presence — keeping them isolated
  // avoids mixing message shapes and makes the demo easier to reason
  // about.
  useEffect(() => {
    const channel = new BroadcastChannel(SYNC_CHANNEL);
    broadcastRef.current = channel;

    channel.onmessage = (e: MessageEvent<SyncMessage>) => {
      const msg = e.data;
      if (msg.type !== "eg-walker-event") return;
      if (msg.senderId === userInfo.userId) return;
      // biome-ignore lint/suspicious/noExplicitAny: cross-tab payload
      replica.applyRemoteEvent(msg.event as any);
      const updated = replica.getText();
      setText(updated);
      // Receiving a remote event doesn't change our outgoing count.
    };

    return () => {
      channel.close();
      broadcastRef.current = null;
    };
  }, [replica, userInfo.userId]);

  // Sync any newly-produced local events to peers. Tracking the count
  // means we only emit the latest delta per edit instead of resending
  // the entire event graph.
  const broadcastNewEvents = useCallback(() => {
    const events = replica.exportEventGraph();
    const channel = broadcastRef.current;
    if (!channel) return;
    for (let i = lastSentEventCountRef.current; i < events.length; i++) {
      channel.postMessage({
        type: "eg-walker-event",
        senderId: userInfo.userId,
        event: events[i],
      } satisfies SyncMessage);
    }
    lastSentEventCountRef.current = events.length;
  }, [replica, userInfo.userId]);

  const handleTextChange = useCallback(
    (newText: string) => {
      const oldText = replica.getText();
      if (newText === oldText) return;

      if (newText.length > oldText.length) {
        const insertPos = findInsertPosition(oldText, newText);
        const insertedText = newText.slice(
          insertPos,
          insertPos + (newText.length - oldText.length),
        );
        replica.insert(insertPos, insertedText);
      } else if (newText.length < oldText.length) {
        const deletePos = findDeletePosition(oldText, newText);
        const deleteCount = oldText.length - newText.length;
        replica.delete(deletePos, deleteCount);
      } else {
        const { start, end } = findDifferingRange(oldText, newText);
        const deleteCount = end - start + 1;
        const replacementText = newText.slice(start, end + 1);
        replica.delete(start, deleteCount);
        replica.insert(start, replacementText);
      }

      setText(replica.getText());
      broadcastNewEvents();
    },
    [broadcastNewEvents, replica],
  );

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900 p-4 md:p-8">
      <div className="max-w-4xl mx-auto space-y-6">
        <header className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-widest text-cyan-400 font-semibold">
              Pokédex · Awareness Lab
            </p>
            <h1 className="text-2xl md:text-3xl font-bold text-white mt-1">
              Awareness + Eg-Walker Demo
            </h1>
            <p className="text-gray-400 text-sm mt-2 max-w-xl">
              Open this URL in multiple tabs to see real-time CRDT text sync
              alongside live cursors, selection highlights, and per-block
              presence — all powered by{" "}
              <code className="text-cyan-400">@softmaple/awareness</code> and{" "}
              <code className="text-cyan-400">@softmaple/eg-walker</code>.
            </p>
          </div>
          <div className="flex items-center gap-2 self-end sm:self-auto">
            <Link
              to="/"
              className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-gray-300 text-sm transition-colors"
            >
              Home
            </Link>
            <button
              type="button"
              onClick={onLeave}
              className="px-3 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-gray-200 text-sm transition-colors"
            >
              Switch Trainer
            </button>
          </div>
        </header>

        <AwarenessOverlay adapter={adapter} userInfo={userInfo}>
          <EditorSurface
            text={text}
            onTextChange={handleTextChange}
            textareaRef={textareaRef}
            trainerId={trainerId}
          />
        </AwarenessOverlay>

        <footer className="text-xs text-gray-500 text-center pt-4">
          BroadcastChannel transport · Eg-Walker CRDT · No server required
        </footer>
      </div>
    </div>
  );
}
