import { EgWalkerReplica } from "@softmaple/eg-walker";
import {
  captureAnchor,
  tryResolveAnchor,
  type AnchorAffinity,
} from "@softmaple/eg-walker/anchors";

import { BOOTSTRAP_BATCH_ID } from "../constants";
import {
  materializeBlockState,
  type MaterializedBlockState,
  type ProjectedBlock,
} from "../materialize";
import type {
  BlockAnchor,
  BlockId,
  ResolvedBlockAnchor,
  RichTextEventBatch,
} from "../types";
import { BOOTSTRAP_BATCH, compareIds, sameBatch, toGraphEvent } from "../wire";

export interface RebuiltReplica {
  readonly egWalker: EgWalkerReplica;
  readonly integratedBatchIds: Set<string>;
  readonly state: MaterializedBlockState;
}

/**
 * Test oracle: replay every ready batch into a fresh EG-walker replica and
 * materialize the whole history, as BlockReplica did on every update before
 * it kept a long-lived replica.
 */
export const rebuildReplica = (
  replicaId: string,
  batches: ReadonlyMap<string, RichTextEventBatch>,
): RebuiltReplica => {
  const ordered = readyBatches(batches);
  const egWalker = new EgWalkerReplica(replicaId);
  for (const batch of ordered) {
    egWalker.applyRemoteEvents(batch.events.map(toGraphEvent));
  }
  const events = ordered.flatMap((batch) => [...batch.events]);
  return {
    egWalker,
    integratedBatchIds: new Set(ordered.map((batch) => batch.batchId)),
    state: materializeBlockState(egWalker, events),
  };
};

/** Rebuild from exported batches, which always include the bootstrap batch. */
export const rebuildFromBatches = (
  replicaId: string,
  batches: ReadonlyArray<RichTextEventBatch>,
): RebuiltReplica =>
  rebuildReplica(
    replicaId,
    new Map(batches.map((batch) => [batch.batchId, batch])),
  );

const readyBatches = (
  batches: ReadonlyMap<string, RichTextEventBatch>,
): RichTextEventBatch[] => {
  const bootstrap = batches.get(BOOTSTRAP_BATCH_ID);
  if (bootstrap === undefined || !sameBatch(bootstrap, BOOTSTRAP_BATCH)) {
    throw new Error("Block replica has no valid deterministic bootstrap batch");
  }
  const ordered = [bootstrap];
  const integratedEvents = new Set(bootstrap.events.map((event) => event.id));
  const remaining = [...batches.values()]
    .filter((batch) => batch.batchId !== BOOTSTRAP_BATCH_ID)
    .sort((left, right) => compareIds(left.batchId, right.batchId));
  let progressed = true;
  while (progressed) {
    progressed = false;
    for (let index = 0; index < remaining.length; index++) {
      const batch = remaining[index]!;
      if (
        !batch.parentVersion.every((parent) => integratedEvents.has(parent))
      ) {
        continue;
      }
      ordered.push(batch);
      batch.events.forEach((event) => integratedEvents.add(event.id));
      remaining.splice(index, 1);
      index--;
      progressed = true;
    }
  }
  return ordered;
};

/** Capture a block anchor the way BlockReplica did against a full rebuild. */
export const captureBlockAnchorFromRebuild = (
  rebuilt: RebuiltReplica,
  blockId: BlockId,
  offset: number,
  affinity: AnchorAffinity,
): BlockAnchor => {
  const projected = rebuilt.state.projectedBlocks.find(
    ({ block }) => block.id === blockId,
  );
  if (projected === undefined) {
    throw new Error(`Unknown or hidden block ${blockId}`);
  }
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw new Error("Block offset must be a non-negative safe integer");
  }
  const rawIndex = projected.boundaries.get(offset);
  if (rawIndex === undefined) {
    throw new Error(
      `Block offset ${offset} is out of range or splits a surrogate pair`,
    );
  }
  return Object.freeze({
    blockId,
    anchor: captureAnchor(rebuilt.egWalker, rawIndex, affinity),
  });
};

/** Resolve a block anchor the way BlockReplica did against a full rebuild. */
export const tryResolveBlockAnchorFromRebuild = (
  rebuilt: RebuiltReplica,
  anchor: BlockAnchor,
): ResolvedBlockAnchor | null => {
  const rawIndex = tryResolveAnchor(rebuilt.egWalker, anchor.anchor);
  if (rawIndex === null) {
    return null;
  }
  const resolved = nearestBlockBoundary(
    rebuilt.state.projectedBlocks,
    rawIndex,
    anchor,
  );
  if (resolved === null) {
    throw new Error("Cannot resolve block anchor in an empty document");
  }
  return resolved;
};

const nearestBlockBoundary = (
  projectedBlocks: ReadonlyArray<ProjectedBlock>,
  rawIndex: number,
  anchor: BlockAnchor,
): ResolvedBlockAnchor | null => {
  let best: {
    readonly blockId: BlockId;
    readonly offset: number;
    readonly raw: number;
  } | null = null;
  for (const projected of projectedBlocks) {
    for (const { offset, raw } of projected.anchorBoundaries) {
      if (best === null) {
        best = { blockId: projected.block.id, offset, raw };
        continue;
      }
      const distance = Math.abs(raw - rawIndex);
      const bestDistance = Math.abs(best.raw - rawIndex);
      const affinity: AnchorAffinity = anchor.anchor.affinity;
      const preferredTie =
        distance === bestDistance &&
        ((raw === best.raw &&
          projected.block.id === anchor.blockId &&
          best.blockId !== anchor.blockId) ||
          (raw !== best.raw &&
            (affinity === "after" ? raw < best.raw : raw > best.raw)));
      if (distance < bestDistance || preferredTie) {
        best = { blockId: projected.block.id, offset, raw };
      }
    }
  }
  return best === null
    ? null
    : Object.freeze({ blockId: best.blockId, offset: best.offset });
};
