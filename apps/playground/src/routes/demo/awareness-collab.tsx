import {
  EgWalkerReplica,
  type EventId,
  type GraphEvent,
} from "@softmaple/eg-walker";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { AwarenessOverlay } from "@/components/awareness-collab/AwarenessOverlay";
import {
  COLLAB_BLOCK_ID,
  EditorSurface,
} from "@/components/awareness-collab/EditorSurface";
import { TrainerPicker } from "@/components/awareness-collab/TrainerPicker";
import {
  findDeletePosition,
  findDifferingRange,
  findInsertPosition,
} from "@/lib/text-diff";
import { getTrainer } from "@/modules/awareness-collab/trainers";
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

/**
 * Cross-tab sync protocol. Three message shapes:
 *
 * - `event`     a single newly-produced event, broadcast as it happens.
 * - `request`   a freshly-mounted tab asks peers for their event graph.
 * - `snapshot`  a peer's reply to `request` carrying their full event graph.
 *
 * `recipientId` is set on `snapshot` so other already-synced tabs can ignore
 * it cheaply. `request` and `event` are broadcast to all tabs in the room.
 */
type SyncMessage =
  | {
      readonly type: "event";
      readonly senderId: string;
      readonly event: GraphEvent;
    }
  | {
      readonly type: "request";
      readonly senderId: string;
    }
  | {
      readonly type: "snapshot";
      readonly senderId: string;
      readonly recipientId: string;
      readonly events: ReadonlyArray<GraphEvent>;
    };

function CollabSession({
  trainerId,
  onLeave,
}: {
  readonly trainerId: string;
  readonly onLeave: () => void;
}) {
  const { adapter, userInfo } = useAwarenessAdapter(trainerId, ROOM_ID);
  const trainer = getTrainer(trainerId);
  const [replica] = useState(() => new EgWalkerReplica(userInfo.userId, ""));
  const [text, setText] = useState("");
  const broadcastRef = useRef<BroadcastChannel | null>(null);
  // Event IDs we've already published (either broadcast ourselves or
  // received from a peer). Using IDs — rather than a graph-length index —
  // means applying a remote event never causes us to re-broadcast it on the
  // next local edit.
  const publishedIdsRef = useRef<Set<EventId>>(new Set());
  // Length of the exported graph prefix the broadcast loop has already
  // inspected. Lets every keystroke skip the O(N) re-scan and only walk
  // freshly-appended events. The Set above is still the source of truth for
  // dedupe — this just bounds the iteration.
  const scannedPrefixRef = useRef(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Separate BroadcastChannel for CRDT event sync. Awareness adapter
  // already opens its own channel for presence — keeping them isolated
  // avoids mixing message shapes and makes the demo easier to reason
  // about.
  useEffect(() => {
    const channel = new BroadcastChannel(SYNC_CHANNEL);
    broadcastRef.current = channel;
    const selfId = userInfo.userId;

    const acceptRemote = (event: GraphEvent): void => {
      replica.applyRemoteEvent(event);
      // Mark as published-from-elsewhere so our outbound loop doesn't
      // bounce it back to peers.
      publishedIdsRef.current.add(event.id);
    };

    channel.onmessage = (e: MessageEvent<SyncMessage>) => {
      const msg = e.data;
      if (msg.senderId === selfId) return;

      switch (msg.type) {
        case "event": {
          acceptRemote(msg.event);
          setText(replica.getText());
          return;
        }
        case "request": {
          // Reply only if we have anything to share. Multiple already-synced
          // tabs may answer; the requester dedups by event id in the replica.
          //
          // Note: `exportEventGraph` returns only events that have been
          // integrated into the graph. Remote events that are still buffered
          // in the replica waiting on missing parents won't be in the
          // snapshot. Convergence still holds — those buffered events were
          // produced by some peer who is also in the room and will reply to
          // the same `request` with their own (more complete) graph — but
          // the requester may briefly observe a graph that lags behind its
          // most-advanced peer.
          const events = replica.exportEventGraph();
          if (events.length === 0) return;
          channel.postMessage({
            type: "snapshot",
            senderId: selfId,
            recipientId: msg.senderId,
            events,
          } satisfies SyncMessage);
          return;
        }
        case "snapshot": {
          if (msg.recipientId !== selfId) return;
          for (const event of msg.events) {
            acceptRemote(event);
          }
          setText(replica.getText());
          return;
        }
      }
    };

    // Ask any open tab for their event graph so we don't start at "".
    channel.postMessage({
      type: "request",
      senderId: selfId,
    } satisfies SyncMessage);

    return () => {
      channel.close();
      broadcastRef.current = null;
    };
  }, [replica, userInfo.userId]);

  // Broadcast events the replica has produced that we haven't shared yet.
  // Resumes from `scannedPrefixRef` so each keystroke walks only freshly-
  // appended events; the id Set still dedupes inside the suffix in case a
  // remote event landed at the tail between scans.
  const broadcastNewEvents = useCallback(() => {
    const channel = broadcastRef.current;
    if (!channel) return;
    const selfId = userInfo.userId;
    const events = replica.exportEventGraph();
    // Defensive: if the graph ever shrinks (shouldn't happen with an
    // append-only CRDT, but guards against future replica behavior), rescan
    // from the beginning. The id Set keeps us correct either way.
    if (events.length < scannedPrefixRef.current) {
      scannedPrefixRef.current = 0;
    }
    for (let i = scannedPrefixRef.current; i < events.length; i++) {
      const event = events[i];
      if (!event) continue;
      if (publishedIdsRef.current.has(event.id)) continue;
      channel.postMessage({
        type: "event",
        senderId: selfId,
        event,
      } satisfies SyncMessage);
      publishedIdsRef.current.add(event.id);
    }
    scannedPrefixRef.current = events.length;
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
              onClick={() => {
                // Mid-edit accidental clicks here drop the local
                // presence and re-mount the adapter — annoying but
                // recoverable. A confirm prompt is heavier than a
                // demo button warrants; the muted text styling
                // (vs. the chunkier "Home" link) signals it as a
                // secondary action without going full modal.
                if (window.confirm("Leave this trainer and pick a new one?")) {
                  onLeave();
                }
              }}
              className="px-3 py-2 text-gray-400 hover:text-gray-200 text-sm transition-colors underline-offset-4 hover:underline"
            >
              Change trainer →
            </button>
          </div>
        </header>

        <AwarenessOverlay
          adapter={adapter}
          userInfo={userInfo}
          accentColor={trainer?.color}
        >
          <EditorSurface
            blockId={COLLAB_BLOCK_ID}
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
