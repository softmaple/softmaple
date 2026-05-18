/**
 * Two-replica textarea demo wiring built on the
 * `@softmaple/awareness/bindings/textarea` reference adapter.
 *
 * Responsibilities:
 * - own the two `EgWalkerReplica` instances
 * - bridge each adapter's local `TextareaOperation` batches into its
 *   replica, then walk the resulting events into the peer replica
 * - hand the resulting batch back to the peer adapter so the peer
 *   textarea writes the new value and remaps its selection
 *
 * Everything CRDT-shaped (replica calls, event walking) lives here
 * because the binding intentionally has no eg-walker dependency.
 */

import {
  computeTextareaOperations,
  type TextareaOperation,
  toTextareaOperation,
  type UseTextareaCollaborationResult,
  useTextareaCollaboration,
} from "@softmaple/awareness/bindings/textarea";
import { POSITION_OPERATION_TYPE } from "@softmaple/awareness/mapping";
import {
  APPLY_REMOTE_EVENT_STATUS,
  EgWalkerReplica,
} from "@softmaple/eg-walker";
import {
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

const applyTextareaOperationToReplica = (
  operation: TextareaOperation,
  replica: EgWalkerReplica,
): void => {
  if (operation.type === POSITION_OPERATION_TYPE.Delete) {
    replica.delete(operation.index, operation.length);
    return;
  }
  replica.insert(operation.index, operation.text);
};

export type ReplicaSyncContext = {
  readonly localReplica: EgWalkerReplica;
  readonly remoteReplica: EgWalkerReplica;
  readonly remoteCollaboration: UseTextareaCollaborationResult | null;
  readonly remoteLabel: string;
};

/**
 * Apply a batch of locally-derived textarea operations to the local
 * replica, walk the resulting events into the remote replica, and hand
 * the collected (textarea-shaped) batch to the remote adapter so the
 * remote textarea writes the new value and remaps its selection.
 *
 * Exported for the wiring tests in `apps/playground/src/test/`.
 */
export const syncLocalOperationsToRemote = async (
  operations: readonly TextareaOperation[],
  context: ReplicaSyncContext,
): Promise<void> => {
  if (operations.length === 0) {
    return;
  }
  const { localReplica, remoteReplica, remoteCollaboration, remoteLabel } =
    context;

  // Snapshot the event graph before applying so we walk exactly the
  // events this batch produced — `operations.length` is not a safe
  // proxy because the replica may coalesce or split.
  const eventsBeforeApply = localReplica.exportEventGraph().length;
  for (const operation of operations) {
    applyTextareaOperationToReplica(operation, localReplica);
  }
  const newEvents = localReplica.exportEventGraph().slice(eventsBeforeApply);

  const appliedRemoteOperations: TextareaOperation[] = [];
  try {
    for (const remoteEvent of newEvents) {
      const textBefore = remoteReplica.getText();
      const result = await remoteReplica.applyRemoteEvent(remoteEvent);
      if (result.status !== APPLY_REMOTE_EVENT_STATUS.Integrated) {
        continue;
      }
      const textAfter = remoteReplica.getText();
      if (result.operation) {
        appliedRemoteOperations.push(
          toTextareaOperation(result.operation, textAfter),
        );
        continue;
      }
      // Engine could not attribute a single op (partial/full replay or
      // multi-op coalesced delete). Reconstruct from pre/post text so
      // the adapter still gets a faithful batch.
      appliedRemoteOperations.push(
        ...computeTextareaOperations(textBefore, textAfter),
      );
    }
  } catch (error) {
    console.error(`Failed to sync edit to ${remoteLabel}:`, error);
  }

  remoteCollaboration?.applyRemoteOperations(appliedRemoteOperations);
};

export type UseCollaborativeEditorResult = {
  readonly replica1Ref: RefObject<HTMLTextAreaElement | null>;
  readonly replica2Ref: RefObject<HTMLTextAreaElement | null>;
};

export const useCollaborativeEditor = (): UseCollaborativeEditorResult => {
  const [api1] = useState(() => new EgWalkerReplica("replica-1"));
  const [api2] = useState(() => new EgWalkerReplica("replica-2"));
  const replica1Ref = useRef<HTMLTextAreaElement>(null);
  const replica2Ref = useRef<HTMLTextAreaElement>(null);
  // Cross-reference via refs because each adapter's `onLocalOperations`
  // calls into the *other* adapter's `applyRemoteOperations`, and the
  // second `useTextareaCollaboration` result is not yet defined when
  // the first callback closes over it.
  const collab1Ref = useRef<UseTextareaCollaborationResult | null>(null);
  const collab2Ref = useRef<UseTextareaCollaborationResult | null>(null);

  const handleReplica1LocalOps = useCallback(
    (operations: readonly TextareaOperation[]) => {
      void syncLocalOperationsToRemote(operations, {
        localReplica: api1,
        remoteReplica: api2,
        remoteCollaboration: collab2Ref.current,
        remoteLabel: "replica-2",
      });
    },
    [api1, api2],
  );

  const handleReplica2LocalOps = useCallback(
    (operations: readonly TextareaOperation[]) => {
      void syncLocalOperationsToRemote(operations, {
        localReplica: api2,
        remoteReplica: api1,
        remoteCollaboration: collab1Ref.current,
        remoteLabel: "replica-1",
      });
    },
    [api1, api2],
  );

  const collab1 = useTextareaCollaboration({
    textareaRef: replica1Ref,
    onLocalOperations: handleReplica1LocalOps,
  });
  const collab2 = useTextareaCollaboration({
    textareaRef: replica2Ref,
    onLocalOperations: handleReplica2LocalOps,
  });
  // The binding's own DOM listeners only fire after its mount effect
  // runs, which is after this effect — so the refs are always populated
  // by the time `handleReplica{1,2}LocalOps` can read them.
  useEffect(() => {
    collab1Ref.current = collab1;
    collab2Ref.current = collab2;
  }, [collab1, collab2]);

  return { replica1Ref, replica2Ref };
};
