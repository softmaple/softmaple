import {
  mapTextareaSelectionThroughOperation,
  type TextareaSelection,
  type UseTextareaSelectionSyncResult,
  useTextareaSelectionSync,
} from "@softmaple/awareness/hooks";
import {
  findDeletePosition,
  findDifferingRange,
  findInsertPosition,
  POSITION_OPERATION_TYPE,
  type PositionOperation,
} from "@softmaple/awareness/mapping";
import { EgWalkerReplica } from "@softmaple/eg-walker";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@softmaple/ui/components/card";
import { Textarea } from "@softmaple/ui/components/textarea";
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useRef, useState } from "react";

export const Route = createFileRoute("/demo/collaborative-editor")({
  component: CollaborativeEditor,
});

type LocalEdit = {
  readonly mappingOperations: readonly PositionOperation[];
  readonly apply: (replica: EgWalkerReplica) => void;
};

const computeLocalEdit = (
  oldText: string,
  newText: string,
): LocalEdit | null => {
  if (newText === oldText) {
    return null;
  }

  if (newText.length > oldText.length) {
    const insertPos = findInsertPosition(oldText, newText);
    const insertedText = newText.slice(
      insertPos,
      insertPos + (newText.length - oldText.length),
    );
    return {
      mappingOperations: [
        {
          type: POSITION_OPERATION_TYPE.Insert,
          index: insertPos,
          length: insertedText.length,
        },
      ],
      apply: (replica) => {
        replica.insert(insertPos, insertedText);
      },
    };
  }

  if (newText.length < oldText.length) {
    const deletePos = findDeletePosition(oldText, newText);
    const deleteCount = oldText.length - newText.length;
    return {
      mappingOperations: [
        {
          type: POSITION_OPERATION_TYPE.Delete,
          index: deletePos,
          length: deleteCount,
        },
      ],
      apply: (replica) => {
        replica.delete(deletePos, deleteCount);
      },
    };
  }

  const { start, end } = findDifferingRange(oldText, newText);
  const length = end - start + 1;
  const replacementText = newText.slice(start, end + 1);
  return {
    mappingOperations: [
      {
        type: POSITION_OPERATION_TYPE.Delete,
        index: start,
        length,
      },
      {
        type: POSITION_OPERATION_TYPE.Insert,
        index: start,
        length: replacementText.length,
      },
    ],
    apply: (replica) => {
      replica.delete(start, length);
      replica.insert(start, replacementText);
    },
  };
};

const mapSelectionThroughOperations = (
  selection: TextareaSelection,
  operations: readonly PositionOperation[],
): TextareaSelection =>
  operations.reduce<TextareaSelection>(
    (current, operation) =>
      mapTextareaSelectionThroughOperation(current, operation),
    selection,
  );

type ReplicaChangeContext = {
  readonly localReplica: EgWalkerReplica;
  readonly remoteReplica: EgWalkerReplica;
  readonly localSync: UseTextareaSelectionSyncResult;
  readonly remoteSync: UseTextareaSelectionSyncResult;
  readonly setLocalText: React.Dispatch<React.SetStateAction<string>>;
  readonly setRemoteText: React.Dispatch<React.SetStateAction<string>>;
  readonly remoteLabel: string;
};

const runReplicaChange = async (
  event: React.ChangeEvent<HTMLTextAreaElement>,
  context: ReplicaChangeContext,
): Promise<void> => {
  const {
    localReplica,
    remoteReplica,
    localSync,
    remoteSync,
    setLocalText,
    setRemoteText,
    remoteLabel,
  } = context;

  const newText = event.target.value;
  const oldText = localReplica.getText();
  const edit = computeLocalEdit(oldText, newText);

  if (!edit) {
    setLocalText(localReplica.getText());
    setRemoteText(remoteReplica.getText());
    return;
  }

  // Capture cursor positions before any state mutation so we can restore the
  // local cursor and map the remote cursor through the local operation(s).
  localSync.captureSelection();
  const remoteSelection = remoteSync.captureSelection();

  edit.apply(localReplica);

  const events = localReplica.exportEventGraph();
  const newEvents = events.slice(-edit.mappingOperations.length);
  try {
    for (const remoteEvent of newEvents) {
      await remoteReplica.applyRemoteEvent(remoteEvent);
    }
  } catch (error) {
    console.error(`Failed to sync edit to ${remoteLabel}:`, error);
  }

  setLocalText(localReplica.getText());
  localSync.restoreSelection();

  setRemoteText(remoteReplica.getText());
  if (remoteSelection) {
    remoteSync.restoreSelection(
      mapSelectionThroughOperations(remoteSelection, edit.mappingOperations),
    );
  }
};

function CollaborativeEditor() {
  const [replica1Text, setReplica1Text] = useState("");
  const [replica2Text, setReplica2Text] = useState("");
  const [api1] = useState(() => new EgWalkerReplica("replica-1"));
  const [api2] = useState(() => new EgWalkerReplica("replica-2"));
  const replica1Ref = useRef<HTMLTextAreaElement>(null);
  const replica2Ref = useRef<HTMLTextAreaElement>(null);
  const replica1Sync = useTextareaSelectionSync(replica1Ref);
  const replica2Sync = useTextareaSelectionSync(replica2Ref);

  const handleReplica1Change = useCallback(
    (event: React.ChangeEvent<HTMLTextAreaElement>) =>
      runReplicaChange(event, {
        localReplica: api1,
        remoteReplica: api2,
        localSync: replica1Sync,
        remoteSync: replica2Sync,
        setLocalText: setReplica1Text,
        setRemoteText: setReplica2Text,
        remoteLabel: "replica-2",
      }),
    [api1, api2, replica1Sync, replica2Sync],
  );

  const handleReplica2Change = useCallback(
    (event: React.ChangeEvent<HTMLTextAreaElement>) =>
      runReplicaChange(event, {
        localReplica: api2,
        remoteReplica: api1,
        localSync: replica2Sync,
        remoteSync: replica1Sync,
        setLocalText: setReplica2Text,
        setRemoteText: setReplica1Text,
        remoteLabel: "replica-1",
      }),
    [api1, api2, replica1Sync, replica2Sync],
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
              <Textarea
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
