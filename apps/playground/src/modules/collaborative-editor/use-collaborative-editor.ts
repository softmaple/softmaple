import {
  mapTextareaSelectionThroughOperation,
  type TextareaSelection,
  type UseTextareaSelectionSyncResult,
  useTextareaSelectionSync,
} from "@softmaple/awareness/hooks";
import {
  findChangedSpan,
  POSITION_OPERATION_TYPE,
  type PositionOperation,
} from "@softmaple/awareness/mapping";
import {
  APPLY_REMOTE_EVENT_STATUS,
  EgWalkerReplica,
} from "@softmaple/eg-walker";
import {
  type ChangeEvent,
  type Dispatch,
  type RefObject,
  type SetStateAction,
  useCallback,
  useRef,
  useState,
} from "react";

export type LocalEdit = {
  readonly mappingOperations: readonly PositionOperation[];
  readonly apply: (replica: EgWalkerReplica) => void;
};

export const computeLocalEdit = (
  oldText: string,
  newText: string,
): LocalEdit | null => {
  if (newText === oldText) {
    return null;
  }

  const { prefix, suffix } = findChangedSpan(oldText, newText);
  const deletedLength = oldText.length - prefix - suffix;
  const insertedText = newText.slice(prefix, newText.length - suffix);
  const mappingOperations: PositionOperation[] = [];

  if (deletedLength > 0) {
    mappingOperations.push({
      type: POSITION_OPERATION_TYPE.Delete,
      index: prefix,
      length: deletedLength,
    });
  }

  if (insertedText.length > 0) {
    mappingOperations.push({
      type: POSITION_OPERATION_TYPE.Insert,
      index: prefix,
      length: insertedText.length,
    });
  }

  return {
    mappingOperations,
    apply: (replica) => {
      if (deletedLength > 0) {
        replica.delete(prefix, deletedLength);
      }
      if (insertedText.length > 0) {
        replica.insert(prefix, insertedText);
      }
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

export type ReplicaChangeContext = {
  readonly localReplica: EgWalkerReplica;
  readonly remoteReplica: EgWalkerReplica;
  readonly localSync: UseTextareaSelectionSyncResult;
  readonly remoteSync: UseTextareaSelectionSyncResult;
  readonly setLocalText: Dispatch<SetStateAction<string>>;
  readonly setRemoteText: Dispatch<SetStateAction<string>>;
  readonly remoteLabel: string;
};

export const runReplicaChange = async (
  event: ChangeEvent<HTMLTextAreaElement>,
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

  // Capture cursor positions into local vars (not just the hook's shared ref)
  // so a concurrent edit firing during the await below cannot overwrite the
  // selection this handler will restore.
  const localSelection = localSync.captureSelection();
  const remoteSelection = remoteSync.captureSelection();

  // Snapshot the event graph length before applying so we walk exactly the
  // events this edit produced, without assuming "one replica call = one
  // event" or N == mappingOperations.length.
  const eventsBeforeApply = localReplica.exportEventGraph().length;
  edit.apply(localReplica);
  const newEvents = localReplica.exportEventGraph().slice(eventsBeforeApply);

  const appliedMappingOperations: PositionOperation[] = [];
  try {
    for (const [index, remoteEvent] of newEvents.entries()) {
      const result = await remoteReplica.applyRemoteEvent(remoteEvent);
      if (result.status !== APPLY_REMOTE_EVENT_STATUS.Integrated) {
        continue;
      }
      // Prefer the engine-attributed PositionOperation: it reflects the
      // actual effect-index integration on the remote replica, which is
      // what selection mapping needs. Fall back to the locally-computed
      // mapping operation only when the engine returned `null` (visible
      // no-op, multi-op coalesced delete, or partial/full replay path)
      // — in that case the local mapping op is still the best available
      // approximation for the simple two-replica scenario.
      const mappingOperation =
        result.operation ?? edit.mappingOperations[index] ?? null;
      if (mappingOperation) {
        appliedMappingOperations.push(mappingOperation);
      }
    }
  } catch (error) {
    console.error(`Failed to sync edit to ${remoteLabel}:`, error);
  }

  setLocalText(localReplica.getText());
  localSync.restoreSelection(localSelection);

  setRemoteText(remoteReplica.getText());
  if (remoteSelection && appliedMappingOperations.length > 0) {
    remoteSync.restoreSelection(
      mapSelectionThroughOperations(remoteSelection, appliedMappingOperations),
    );
  }
};

export type UseCollaborativeEditorResult = {
  readonly replica1Text: string;
  readonly replica2Text: string;
  readonly replica1Ref: RefObject<HTMLTextAreaElement | null>;
  readonly replica2Ref: RefObject<HTMLTextAreaElement | null>;
  readonly handleReplica1Change: (
    event: ChangeEvent<HTMLTextAreaElement>,
  ) => Promise<void>;
  readonly handleReplica2Change: (
    event: ChangeEvent<HTMLTextAreaElement>,
  ) => Promise<void>;
};

export const useCollaborativeEditor = (): UseCollaborativeEditorResult => {
  const [replica1Text, setReplica1Text] = useState("");
  const [replica2Text, setReplica2Text] = useState("");
  const [api1] = useState(() => new EgWalkerReplica("replica-1"));
  const [api2] = useState(() => new EgWalkerReplica("replica-2"));
  const replica1Ref = useRef<HTMLTextAreaElement>(null);
  const replica2Ref = useRef<HTMLTextAreaElement>(null);
  const replica1Sync = useTextareaSelectionSync(replica1Ref);
  const replica2Sync = useTextareaSelectionSync(replica2Ref);

  const handleReplica1Change = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) =>
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
    (event: ChangeEvent<HTMLTextAreaElement>) =>
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

  return {
    replica1Text,
    replica2Text,
    replica1Ref,
    replica2Ref,
    handleReplica1Change,
    handleReplica2Change,
  };
};
