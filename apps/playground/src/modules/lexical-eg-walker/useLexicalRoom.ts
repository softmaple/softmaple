import type { LexicalBinding } from "@softmaple/binding-lexical";
import {
  type BlockReplica,
  createBlockReplica,
  parseRichTextEventBatch,
  type RichTextEventBatch,
} from "@softmaple/block-model";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  createPersistenceCoordinator,
  type PersistenceCoordinator,
  type PersistenceCoordinatorSnapshot,
} from "./persistence/coordinator";
import { type WireBatch, WireBatchSchema } from "./persistence/schema";

export interface LexicalRoomState {
  readonly replica: BlockReplica | null;
  readonly persistence: PersistenceCoordinatorSnapshot | null;
  readonly error: Error | null;
  readonly onBindingChange: (binding: LexicalBinding | null) => void;
  readonly flush: () => Promise<void>;
}

export interface SessionValue<T> {
  readonly sessionKey: string;
  readonly value: T;
}

export const sessionKeyFor = (roomId: string, peerId: string): string =>
  JSON.stringify([roomId, peerId]);

const parseBatch = (batch: WireBatch): RichTextEventBatch =>
  parseRichTextEventBatch(batch);

const wireBatch = (batch: RichTextEventBatch): WireBatch =>
  WireBatchSchema.parse(batch);

export const parsePersistenceBatch = (input: unknown): WireBatch =>
  wireBatch(parseRichTextEventBatch(input));

export const useLexicalRoom = (
  roomId: string,
  peerId: string,
): LexicalRoomState => {
  const sessionKey = sessionKeyFor(roomId, peerId);
  const [replicaState, setReplicaState] =
    useState<SessionValue<BlockReplica> | null>(null);
  const [persistenceState, setPersistenceState] =
    useState<SessionValue<PersistenceCoordinatorSnapshot> | null>(null);
  const [errorState, setErrorState] = useState<SessionValue<Error> | null>(
    null,
  );
  const bindingRef = useRef<SessionValue<LexicalBinding> | null>(null);
  const coordinatorRef = useRef<SessionValue<PersistenceCoordinator> | null>(
    null,
  );

  const onBindingChange = useCallback(
    (binding: LexicalBinding | null) => {
      if (binding === null) {
        if (bindingRef.current?.sessionKey === sessionKey) {
          bindingRef.current = null;
        }
        return;
      }
      bindingRef.current = { sessionKey, value: binding };
    },
    [sessionKey],
  );

  useEffect(() => {
    let cancelled = false;
    let coordinator: PersistenceCoordinator | null = null;
    let unsubscribeBatches: (() => void) | null = null;
    let unsubscribeReplica: (() => void) | null = null;
    let unsubscribeState: (() => void) | null = null;
    let unsubscribeErrors: (() => void) | null = null;

    const start = async (): Promise<void> => {
      const nextReplica = createBlockReplica(peerId);
      coordinator = await createPersistenceCoordinator({
        roomId,
        peerId,
        parseBatch: parsePersistenceBatch,
      });
      if (cancelled) {
        await coordinator.close();
        return;
      }
      coordinatorRef.current = { sessionKey, value: coordinator };

      const applyIncoming = (batch: WireBatch): void => {
        const parsed = parseBatch(batch);
        const bindingState = bindingRef.current;
        if (bindingState?.sessionKey !== sessionKey) {
          nextReplica.applyRemoteEvents(parsed);
        } else {
          bindingState.value.applyRemoteEvents(parsed);
        }
      };
      unsubscribeBatches = coordinator.subscribeBatches((batch, source) => {
        if (source !== "local") applyIncoming(batch);
      });
      for (const batch of coordinator.getKnownBatches()) {
        applyIncoming(batch);
      }

      unsubscribeReplica = nextReplica.subscribe((change) => {
        if (change.origin !== "local" || coordinator === null) return;
        for (const batchId of change.batchIds) {
          const batch = nextReplica.getBatch(batchId);
          if (batch !== null) coordinator.publishBatch(wireBatch(batch));
        }
      });
      unsubscribeState = coordinator.subscribeState((value) => {
        setPersistenceState({ sessionKey, value });
      });
      unsubscribeErrors = coordinator.subscribeErrors((value) => {
        setErrorState({ sessionKey, value });
      });
      setPersistenceState({ sessionKey, value: coordinator.getSnapshot() });
      setReplicaState({ sessionKey, value: nextReplica });
    };

    void start().catch((reason: unknown) => {
      if (!cancelled) {
        setErrorState({
          sessionKey,
          value:
            reason instanceof Error
              ? reason
              : new Error("Failed to initialize the collaboration room"),
        });
      }
    });

    const handlePageHide = (): void => {
      void coordinator?.flushPending();
    };
    window.addEventListener("pagehide", handlePageHide);

    return () => {
      cancelled = true;
      window.removeEventListener("pagehide", handlePageHide);
      if (bindingRef.current?.sessionKey === sessionKey) {
        bindingRef.current = null;
      }
      if (coordinatorRef.current?.sessionKey === sessionKey) {
        coordinatorRef.current = null;
      }
      unsubscribeErrors?.();
      unsubscribeState?.();
      unsubscribeReplica?.();
      unsubscribeBatches?.();
      if (coordinator !== null) {
        void coordinator.flushPending().finally(() => coordinator?.close());
      }
    };
  }, [peerId, roomId, sessionKey]);

  const flush = useCallback(async () => {
    const coordinatorState = coordinatorRef.current;
    if (coordinatorState?.sessionKey === sessionKey) {
      await coordinatorState.value.flushPending();
    }
  }, [sessionKey]);

  const replica =
    replicaState?.sessionKey === sessionKey ? replicaState.value : null;
  const persistence =
    persistenceState?.sessionKey === sessionKey ? persistenceState.value : null;
  const error = errorState?.sessionKey === sessionKey ? errorState.value : null;

  return { replica, persistence, error, onBindingChange, flush };
};
