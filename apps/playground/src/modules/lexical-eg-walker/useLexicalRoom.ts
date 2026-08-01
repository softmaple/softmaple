import type {
  LexicalBinding,
  StableBlockSelection,
} from "@softmaple/binding-lexical";
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

const parseBatch = (batch: WireBatch): RichTextEventBatch =>
  parseRichTextEventBatch(batch);

const wireBatch = (batch: RichTextEventBatch): WireBatch =>
  WireBatchSchema.parse(batch);

export const useLexicalRoom = (
  roomId: string,
  peerId: string,
): LexicalRoomState => {
  const [replica, setReplica] = useState<BlockReplica | null>(null);
  const [persistence, setPersistence] =
    useState<PersistenceCoordinatorSnapshot | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const bindingRef = useRef<LexicalBinding | null>(null);
  const coordinatorRef = useRef<PersistenceCoordinator | null>(null);

  const onBindingChange = useCallback((binding: LexicalBinding | null) => {
    bindingRef.current = binding;
  }, []);

  useEffect(() => {
    let cancelled = false;
    let coordinator: PersistenceCoordinator | null = null;
    let unsubscribeBatches: (() => void) | null = null;
    let unsubscribeReplica: (() => void) | null = null;
    let unsubscribeState: (() => void) | null = null;
    let unsubscribeErrors: (() => void) | null = null;

    const start = async (): Promise<void> => {
      const nextReplica = createBlockReplica(peerId);
      coordinator = await createPersistenceCoordinator({ roomId, peerId });
      if (cancelled) {
        await coordinator.close();
        return;
      }
      coordinatorRef.current = coordinator;

      const applyIncoming = (batch: WireBatch): void => {
        const parsed = parseBatch(batch);
        const binding = bindingRef.current;
        if (binding === null) nextReplica.applyRemoteEvents(parsed);
        else binding.applyRemoteEvents(parsed);
      };
      unsubscribeBatches = coordinator.subscribeBatches((batch, source) => {
        if (source !== "local") applyIncoming(batch);
      });
      for (const batch of coordinator.getKnownBatches()) {
        applyIncoming(batch);
      }

      unsubscribeReplica = nextReplica.subscribe((change) => {
        if (change.origin !== "local" || coordinator === null) return;
        const batches = new Map(
          nextReplica
            .exportEvents()
            .map((batch) => [batch.batchId, batch] as const),
        );
        for (const batchId of change.batchIds) {
          const batch = batches.get(batchId);
          if (batch !== undefined) coordinator.publishBatch(wireBatch(batch));
        }
      });
      unsubscribeState = coordinator.subscribeState(setPersistence);
      unsubscribeErrors = coordinator.subscribeErrors(setError);
      setPersistence(coordinator.getSnapshot());
      setReplica(nextReplica);
    };

    void start().catch((reason: unknown) => {
      if (!cancelled) {
        setError(
          reason instanceof Error
            ? reason
            : new Error("Failed to initialize the collaboration room"),
        );
      }
    });

    const handlePageHide = (): void => {
      void coordinator?.flushPending();
    };
    window.addEventListener("pagehide", handlePageHide);

    return () => {
      cancelled = true;
      window.removeEventListener("pagehide", handlePageHide);
      bindingRef.current = null;
      coordinatorRef.current = null;
      unsubscribeErrors?.();
      unsubscribeState?.();
      unsubscribeReplica?.();
      unsubscribeBatches?.();
      if (coordinator !== null) {
        void coordinator.flushPending().finally(() => coordinator?.close());
      }
    };
  }, [peerId, roomId]);

  const flush = useCallback(
    async () => coordinatorRef.current?.flushPending(),
    [],
  );

  return { replica, persistence, error, onBindingChange, flush };
};

export const toPresenceSelection = (
  selection: StableBlockSelection | null,
): StableBlockSelection | null => selection;
