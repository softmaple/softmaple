import {
  computeTextareaOperations,
  type UseTextareaCollaborationResult,
} from "@softmaple/awareness/bindings/textarea";
import {
  APPLY_REMOTE_EVENT_STATUS,
  type EgWalkerReplica,
  type EventId,
  type GraphEvent,
} from "@softmaple/eg-walker";
import { type RefObject, useCallback, useEffect, useRef } from "react";

/**
 * A ref to a boolean flag that the caller updates as the textarea's IME
 * composition state changes. While `isComposingRef.current` is true,
 * incoming peer events are queued rather than applied immediately.
 * Flushed after composition ends via `flushDuringCompositionEvents`.
 */
type IsComposingRef = RefObject<boolean>;

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

type UseBroadcastCollabSessionOptions = {
  readonly replica: EgWalkerReplica;
  readonly userId: string;
  readonly syncChannel: string;
  readonly onTextChange: (text: string) => void;
  readonly isComposingRef: IsComposingRef;
};

type BroadcastCollabSession = {
  readonly collaborationRef: RefObject<UseTextareaCollaborationResult | null>;
  readonly broadcastNewEvents: () => void;
  /**
   * Process peer events that were queued while the textarea was composing.
   * Must be called after composition ends and after the local composition
   * ops have been applied to the replica (i.e. after `onLocalOperations`
   * returns for the composition commit), so the CRDT sees local ops first
   * and peer events can be correctly rebased on top.
   */
  readonly flushDuringCompositionEvents: () => void;
};

export const useBroadcastCollabSession = ({
  replica,
  userId,
  syncChannel,
  onTextChange,
  isComposingRef,
}: UseBroadcastCollabSessionOptions): BroadcastCollabSession => {
  const channelRef = useRef<BroadcastChannel | null>(null);
  const collaborationRef = useRef<UseTextareaCollaborationResult | null>(null);
  // True while a microtask is already queued to flush the remote-event
  // text update. Prevents scheduling multiple `onTextChange` calls when
  // a peer sends a burst of events in the same JS turn.
  const remoteFlushScheduledRef = useRef(false);
  // Event IDs we've already published (either broadcast ourselves or received
  // from a peer). Using IDs rather than a graph-length index means applying a
  // remote event never causes us to re-broadcast it on the next local edit.
  const publishedIdsRef = useRef<Set<EventId>>(new Set());
  // Length of the exported graph prefix already inspected by the broadcast
  // loop. The Set above is still the source of truth for dedupe.
  const scannedPrefixRef = useRef(0);
  // Peer events that arrived while the textarea was composing. We cannot
  // apply them to the replica immediately because their indices would be
  // relative to the pre-composition baseline; the composition's own ops
  // must land first so the CRDT merge is correct. Flushed after
  // compositionend via flushDuringCompositionEvents.
  const duringCompositionEventsRef = useRef<GraphEvent[]>([]);
  const duringCompositionEventIdsRef = useRef<Set<EventId>>(new Set());
  // Set by the useEffect so flushDuringCompositionEvents (defined outside
  // the effect) can reach the closure-local acceptRemote.
  const processBufferedEventsRef = useRef<(() => void) | null>(null);

  const broadcastNewEvents = useCallback(() => {
    const channel = channelRef.current;
    if (!channel) return;
    const events = replica.exportEventGraph();
    if (events.length < scannedPrefixRef.current) {
      scannedPrefixRef.current = 0;
    }
    for (let i = scannedPrefixRef.current; i < events.length; i++) {
      const event = events[i];
      if (!event) continue;
      if (publishedIdsRef.current.has(event.id)) continue;
      channel.postMessage({
        type: "event",
        senderId: userId,
        event,
      } satisfies SyncMessage);
      publishedIdsRef.current.add(event.id);
    }
    scannedPrefixRef.current = events.length;
  }, [replica, userId]);

  const flushDuringCompositionEvents = useCallback(() => {
    processBufferedEventsRef.current?.();
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: isComposingRef is a stable RefObject; reading .current inside the effect always gives the live value without needing the effect to re-run on composition state changes.
  useEffect(() => {
    const channel = new BroadcastChannel(syncChannel);
    channelRef.current = channel;
    const pendingByMissingParent = new Map<EventId, GraphEvent[]>();
    const bufferedEventIds = new Set<EventId>();

    const getIntegratedEventIds = (): Set<EventId> =>
      new Set(replica.exportEventGraph().map((event) => event.id));

    const findMissingParent = (
      event: GraphEvent,
      integratedIds: Set<EventId>,
    ): EventId | null => {
      for (const parentId of event.parentVersion) {
        if (!integratedIds.has(parentId)) {
          return parentId;
        }
      }
      return null;
    };

    const bufferRemote = (event: GraphEvent, missingParent: EventId): void => {
      if (bufferedEventIds.has(event.id)) return;
      const waiters = pendingByMissingParent.get(missingParent) ?? [];
      waiters.push(event);
      pendingByMissingParent.set(missingParent, waiters);
      bufferedEventIds.add(event.id);
    };

    const drainPendingChildren = (parentId: EventId): void => {
      const waiters = pendingByMissingParent.get(parentId);
      if (!waiters) return;
      pendingByMissingParent.delete(parentId);
      for (const waiter of waiters) {
        bufferedEventIds.delete(waiter.id);
        acceptRemote(waiter);
      }
    };

    // `knownIntegratedIds` is an optional pre-computed set the caller
    // can pass when processing events in a batch. It must be mutated in
    // place (add the new ID after applyRemoteEvent) so subsequent
    // iterations of the batch loop see fresh data without re-scanning
    // the graph. When omitted, one fresh scan is done per call.
    const acceptRemote = (
      event: GraphEvent,
      knownIntegratedIds?: Set<EventId>,
    ): void => {
      const integratedIds = knownIntegratedIds ?? getIntegratedEventIds();
      if (integratedIds.has(event.id)) return;
      const missingParent = findMissingParent(event, integratedIds);
      if (missingParent) {
        bufferRemote(event, missingParent);
        return;
      }
      // While the textarea is mid-IME-composition, we cannot apply peer
      // events to the replica yet. The composition's local ops must land
      // first (so their indices are correct relative to the
      // pre-composition baseline); peer events are then applied on top
      // and the CRDT merge resolves any conflicts. See issue #704.
      if (isComposingRef.current) {
        if (!duringCompositionEventIdsRef.current.has(event.id)) {
          duringCompositionEventsRef.current.push(event);
          duringCompositionEventIdsRef.current.add(event.id);
        }
        return;
      }
      const textBefore = replica.getText();
      const result = replica.applyRemoteEvent(event);
      const textAfter = replica.getText();
      publishedIdsRef.current.add(event.id);
      knownIntegratedIds?.add(event.id);
      if (result.status !== APPLY_REMOTE_EVENT_STATUS.Integrated) return;
      const operations = computeTextareaOperations(textBefore, textAfter);
      collaborationRef.current?.applyRemoteOperations(operations);
      drainPendingChildren(event.id);
    };

    processBufferedEventsRef.current = () => {
      const events = duringCompositionEventsRef.current;
      if (events.length === 0) return;
      duringCompositionEventsRef.current = [];
      duringCompositionEventIdsRef.current.clear();
      const integratedIds = getIntegratedEventIds();
      for (const event of events) {
        acceptRemote(event, integratedIds);
      }
      onTextChange(replica.getText());
    };

    channel.onmessage = (event: MessageEvent<SyncMessage>) => {
      const msg = event.data;
      if (msg.senderId === userId) return;

      switch (msg.type) {
        case "event": {
          acceptRemote(msg.event);
          if (!remoteFlushScheduledRef.current) {
            remoteFlushScheduledRef.current = true;
            queueMicrotask(() => {
              remoteFlushScheduledRef.current = false;
              if (channelRef.current) {
                onTextChange(replica.getText());
              }
            });
          }
          return;
        }
        case "request": {
          // Three sources of events that have not yet been applied to the
          // replica must all be included so a joining peer gets the full
          // picture even if the original senders are gone:
          //
          // 1. appliedEvents — replica.exportEventGraph(), the baseline.
          // 2. queuedEvents  — events whose parents are integrated but
          //    that we are holding back until IME composition ends.
          // 3. pendingEvents — descendants buffered behind a missing
          //    parent (including children of queuedEvents whose parent
          //    has not been applied to the replica yet, keyed by the
          //    missing parent ID at every depth of the causal chain).
          const appliedEvents = replica.exportEventGraph();
          const queuedEvents = duringCompositionEventsRef.current;
          const pendingEvents = [...pendingByMissingParent.values()].flat();
          if (
            appliedEvents.length === 0 &&
            queuedEvents.length === 0 &&
            pendingEvents.length === 0
          )
            return;
          channel.postMessage({
            type: "snapshot",
            senderId: userId,
            recipientId: msg.senderId,
            events: [...appliedEvents, ...queuedEvents, ...pendingEvents],
          } satisfies SyncMessage);
          return;
        }
        case "snapshot": {
          if (msg.recipientId !== userId) return;
          const integratedIds = getIntegratedEventIds();
          for (const event of msg.events) {
            acceptRemote(event, integratedIds);
          }
          onTextChange(replica.getText());
          return;
        }
      }
    };

    channel.postMessage({
      type: "request",
      senderId: userId,
    } satisfies SyncMessage);

    return () => {
      channel.close();
      channelRef.current = null;
      processBufferedEventsRef.current = null;
      duringCompositionEventsRef.current = [];
      duringCompositionEventIdsRef.current.clear();
      remoteFlushScheduledRef.current = false;
    };
  }, [onTextChange, replica, syncChannel, userId]);

  return { collaborationRef, broadcastNewEvents, flushDuringCompositionEvents };
};
