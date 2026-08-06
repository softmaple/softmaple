import { useTextareaCollaboration } from "@softmaple/awareness/bindings/textarea";
import { POSITION_OPERATION_TYPE } from "@softmaple/awareness/mapping";
import { EgWalkerReplica } from "@softmaple/eg-walker";
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { AwarenessOverlay } from "@/components/awareness-collab/AwarenessOverlay";
import {
  COLLAB_BLOCK_ID,
  EditorSurface,
} from "@/components/awareness-collab/EditorSurface";
import { TrainerPicker } from "@/components/awareness-collab/TrainerPicker";
import { DemoPageShell } from "@/components/demo/DemoPageShell";
import { getTrainer } from "@/modules/awareness-collab/trainers";
import { useAwarenessAdapter } from "@/modules/awareness-collab/use-awareness-adapter";
import { useBroadcastCollabSession } from "@/modules/awareness-collab/use-broadcast-collab-session";

export const Route = createFileRoute("/demo/awareness-collab")({
  ssr: false,
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
  const isComposingRef = useRef(false);
  const { collaborationRef, broadcastNewEvents, flushDuringCompositionEvents } =
    useBroadcastCollabSession({
      replica,
      userId: userInfo.userId,
      syncChannel: SYNC_CHANNEL,
      onTextChange: setText,
      isComposingRef,
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
    onCompositionChange: (composing) => {
      isComposingRef.current = composing;
      if (!composing) {
        queueMicrotask(flushDuringCompositionEvents);
      }
    },
  });
  useLayoutEffect(() => {
    collaborationRef.current = collaboration;
  }, [collaboration, collaborationRef]);

  return (
    <DemoPageShell
      eyebrow="03 · Awareness lab"
      title="Awareness + Eg-Walker Demo"
      description={
        <>
          Open this URL in multiple tabs to see real-time CRDT text sync
          alongside live cursors, selection highlights, and per-block presence —
          powered by{" "}
          <code className="text-[var(--pg-accent)]">@softmaple/awareness</code>{" "}
          and{" "}
          <code className="text-[var(--pg-accent)]">@softmaple/eg-walker</code>.
        </>
      }
      contentClassName="max-w-4xl"
      actions={
        <button
          type="button"
          onClick={() => {
            if (window.confirm("Leave this trainer and pick a new one?")) {
              onLeave();
            }
          }}
          className="px-3 py-2 text-sm text-[var(--pg-ink-muted)] underline-offset-4 transition-colors hover:text-[var(--pg-ink)] hover:underline"
        >
          Change trainer →
        </button>
      }
    >
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

      <footer className="pt-6 text-center font-[family-name:var(--font-mono)] text-xs text-[var(--pg-ink-muted)]">
        BroadcastChannel transport · Eg-Walker CRDT · No server required
      </footer>
    </DemoPageShell>
  );
}
