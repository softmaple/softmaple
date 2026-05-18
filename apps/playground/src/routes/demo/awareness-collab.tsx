import { useTextareaCollaboration } from "@softmaple/awareness/bindings/textarea";
import { POSITION_OPERATION_TYPE } from "@softmaple/awareness/mapping";
import { EgWalkerReplica } from "@softmaple/eg-walker";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { AwarenessOverlay } from "@/components/awareness-collab/AwarenessOverlay";
import {
  COLLAB_BLOCK_ID,
  EditorSurface,
} from "@/components/awareness-collab/EditorSurface";
import { TrainerPicker } from "@/components/awareness-collab/TrainerPicker";
import { getTrainer } from "@/modules/awareness-collab/trainers";
import { useAwarenessAdapter } from "@/modules/awareness-collab/use-awareness-adapter";
import { useBroadcastCollabSession } from "@/modules/awareness-collab/use-broadcast-collab-session";

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
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { collaborationRef, broadcastNewEvents } = useBroadcastCollabSession({
    replica,
    userId: userInfo.userId,
    syncChannel: SYNC_CHANNEL,
    onTextChange: setText,
  });

  const handleLocalOperations = useCallback<
    Parameters<typeof useTextareaCollaboration>[0]["onLocalOperations"]
  >(
    (operations) => {
      for (const operation of operations) {
        if (operation.type === POSITION_OPERATION_TYPE.Delete) {
          replica.delete(operation.index, operation.length);
          continue;
        }
        replica.insert(operation.index, operation.text);
      }
      setText(replica.getText());
      broadcastNewEvents();
    },
    [broadcastNewEvents, replica],
  );

  const collaboration = useTextareaCollaboration({
    textareaRef,
    onLocalOperations: handleLocalOperations,
  });
  useLayoutEffect(() => {
    collaborationRef.current = collaboration;
  }, [collaboration, collaborationRef]);

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
                // recoverable. `window.confirm` is the lightweight
                // middle ground: enough friction to catch a misclick
                // without building a real modal for a demo button.
                // The muted text styling (vs. the chunkier "Home"
                // link) signals it as a secondary action.
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
            textareaRef={textareaRef}
            trainerId={trainerId}
            isComposing={collaboration.isComposing}
          />
        </AwarenessOverlay>

        <footer className="text-xs text-gray-500 text-center pt-4">
          BroadcastChannel transport · Eg-Walker CRDT · No server required
        </footer>
      </div>
    </div>
  );
}
