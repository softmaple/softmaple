import { EgWalkerReplica, type GraphEvent } from "@softmaple/eg-walker";
import {
  captureAnchor,
  createSequenceAnchorProjection,
  resolveAnchor,
  tryResolveAnchor,
  type AnchorAffinity,
} from "@softmaple/eg-walker/anchors";

import {
  BLOCK_MARKER,
  BLOCK_MODEL_SCHEMA_VERSION,
  BOOTSTRAP_BATCH_ID,
  BOOTSTRAP_BLOCK_ID,
  METADATA_MARKER,
} from "./constants";
import {
  materializeBlockState,
  type MaterializedBlockState,
  type ProjectedBlock,
} from "./materialize";
import type {
  ApplyRichTextEventsResult,
  Block,
  BlockAnchor,
  BlockDocument,
  BlockDocumentInput,
  BlockFieldPatch,
  BlockId,
  BlockInput,
  BlockReplicaListener,
  BlockTransaction,
  LinkAttributes,
  MarkBoundaryAffinity,
  MarkKind,
  MarkSpan,
  ResolvedBlockAnchor,
  RichTextEffect,
  RichTextEvent,
  RichTextEventBatch,
  SerializedBlockReplica,
} from "./types";
import {
  assertFieldPatch,
  BOOTSTRAP_BATCH,
  cloneBatch,
  compareIds,
  encodeText,
  fromGraphEvent,
  isBlockType,
  isLinkAttributes,
  isMarkKind,
  normalizeFields,
  parseBatch,
  sameBatch,
  toGraphEvent,
} from "./wire";

export class BlockReplica {
  private egWalker: EgWalkerReplica;
  private batchesById: Map<string, RichTextEventBatch>;
  private integratedBatchIds: Set<string>;
  private state: MaterializedBlockState;
  private readonly listeners = new Set<BlockReplicaListener>();

  constructor(private readonly replicaId: string) {
    if (replicaId.length === 0) {
      throw new Error("Block replica ID cannot be empty");
    }
    this.batchesById = new Map([[BOOTSTRAP_BATCH_ID, BOOTSTRAP_BATCH]]);
    const rebuilt = rebuildReplica(replicaId, this.batchesById);
    this.egWalker = rebuilt.egWalker;
    this.integratedBatchIds = rebuilt.integratedBatchIds;
    this.state = rebuilt.state;
  }

  transact(
    callback: (transaction: BlockTransaction) => void,
  ): RichTextEventBatch | null {
    const context = new BlockTransactionContext(
      this.replicaId,
      this.egWalker,
      integratedEvents(this.batchesById, this.integratedBatchIds),
    );
    callback(context);
    const batch = context.finish();
    if (batch === null) {
      return null;
    }

    const nextBatches = new Map(this.batchesById);
    nextBatches.set(batch.batchId, batch);
    const rebuilt = rebuildReplica(this.replicaId, nextBatches);
    this.batchesById = nextBatches;
    this.egWalker = rebuilt.egWalker;
    this.integratedBatchIds = rebuilt.integratedBatchIds;
    this.state = rebuilt.state;
    this.notify("local", [batch.batchId]);
    return cloneBatch(batch);
  }

  applyRemoteEvents(
    input: RichTextEventBatch | ReadonlyArray<RichTextEventBatch>,
  ): ApplyRichTextEventsResult {
    const incoming = (Array.isArray(input) ? input : [input]).map((batch) =>
      parseBatch(batch),
    );
    const nextBatches = new Map(this.batchesById);
    const eventOwner = eventOwners(nextBatches);

    for (const batch of incoming) {
      const existing = nextBatches.get(batch.batchId);
      if (existing !== undefined) {
        if (!sameBatch(existing, batch)) {
          throw new Error(`Conflicting batch ID ${batch.batchId}`);
        }
        continue;
      }
      for (const event of batch.events) {
        const owner = eventOwner.get(event.id);
        if (owner !== undefined) {
          throw new Error(
            `Event ID ${event.id} already belongs to batch ${owner}`,
          );
        }
        eventOwner.set(event.id, batch.batchId);
      }
      nextBatches.set(batch.batchId, batch);
    }

    const rebuilt = rebuildReplica(this.replicaId, nextBatches);
    const newlyIntegrated = [...rebuilt.integratedBatchIds]
      .filter(
        (batchId) =>
          batchId !== BOOTSTRAP_BATCH_ID &&
          !this.integratedBatchIds.has(batchId),
      )
      .sort(compareIds);
    this.batchesById = nextBatches;
    this.egWalker = rebuilt.egWalker;
    this.integratedBatchIds = rebuilt.integratedBatchIds;
    this.state = rebuilt.state;
    if (newlyIntegrated.length > 0) {
      this.notify("remote", newlyIntegrated);
    }
    return Object.freeze({
      integratedBatchIds: Object.freeze(newlyIntegrated),
      pendingBatchIds: Object.freeze(
        [...nextBatches.keys()]
          .filter((batchId) => !rebuilt.integratedBatchIds.has(batchId))
          .sort(compareIds),
      ),
    });
  }

  getDocument(): BlockDocument {
    return this.state.document;
  }

  getBatch(batchId: string): RichTextEventBatch | null {
    const batch = this.batchesById.get(batchId);
    return batch === undefined ? null : cloneBatch(batch);
  }

  exportEvents(): ReadonlyArray<RichTextEventBatch> {
    return Object.freeze(
      [...this.batchesById.values()]
        .sort((left, right) => compareIds(left.batchId, right.batchId))
        .map(cloneBatch),
    );
  }

  serialize(): SerializedBlockReplica {
    return Object.freeze({
      schemaVersion: BLOCK_MODEL_SCHEMA_VERSION,
      batches: this.exportEvents(),
    });
  }

  static deserialize(input: unknown, replicaId: string): BlockReplica {
    if (input === null || typeof input !== "object" || Array.isArray(input)) {
      throw new Error("Serialized block replica must be an object");
    }
    const serialized = input as Record<string, unknown>;
    if (serialized.schemaVersion !== BLOCK_MODEL_SCHEMA_VERSION) {
      throw new Error("Unsupported serialized block replica schemaVersion");
    }
    if (!Array.isArray(serialized.batches)) {
      throw new Error("Serialized block replica batches must be an array");
    }
    const batches = serialized.batches.map(parseBatch);
    const bootstrap = batches.find(
      (batch) => batch.batchId === BOOTSTRAP_BATCH_ID,
    );
    if (bootstrap === undefined || !sameBatch(bootstrap, BOOTSTRAP_BATCH)) {
      throw new Error(
        "Serialized block replica is missing its bootstrap batch",
      );
    }
    const replica = new BlockReplica(replicaId);
    replica.applyRemoteEvents(
      batches.filter((batch) => batch.batchId !== BOOTSTRAP_BATCH_ID),
    );
    return replica;
  }

  subscribe(listener: BlockReplicaListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  captureBlockAnchor(
    blockId: BlockId,
    offset: number,
    affinity: AnchorAffinity,
  ): BlockAnchor {
    const projected = requireProjectedBlock(this.state, blockId);
    const rawIndex = rawBoundary(projected, offset);
    return Object.freeze({
      blockId,
      anchor: captureAnchor(this.egWalker, rawIndex, affinity),
    });
  }

  resolveBlockAnchor(anchor: BlockAnchor): ResolvedBlockAnchor {
    const rawIndex = resolveRawAnchor(this.egWalker, anchor);
    const resolved = nearestBlockBoundary(
      this.state.projectedBlocks,
      rawIndex,
      anchor,
    );
    if (resolved === null) {
      throw new Error("Cannot resolve block anchor in an empty document");
    }
    return resolved;
  }

  /**
   * Resolve a block anchor, or return `null` when the underlying sequence atom
   * has not been integrated yet. Invalid anchors still throw.
   */
  tryResolveBlockAnchor(anchor: BlockAnchor): ResolvedBlockAnchor | null {
    const rawIndex = tryResolveRawAnchor(this.egWalker, anchor);
    if (rawIndex === null) {
      return null;
    }
    const resolved = nearestBlockBoundary(
      this.state.projectedBlocks,
      rawIndex,
      anchor,
    );
    if (resolved === null) {
      throw new Error("Cannot resolve block anchor in an empty document");
    }
    return resolved;
  }

  private notify(origin: "local" | "remote", batchIds: string[]): void {
    if (this.listeners.size === 0) {
      return;
    }
    const change = Object.freeze({
      origin,
      batchIds: Object.freeze([...batchIds]),
      document: this.state.document,
    });
    for (const listener of [...this.listeners]) {
      try {
        listener(change);
      } catch {
        // Isolate listener failures so one subscriber cannot block the rest.
      }
    }
  }
}

export const createBlockReplica = (replicaId: string): BlockReplica =>
  new BlockReplica(replicaId);

export const parseRichTextEventBatch = (input: unknown): RichTextEventBatch =>
  parseBatch(input);

export const isRichTextEventBatch = (
  input: unknown,
): input is RichTextEventBatch => {
  try {
    parseBatch(input);
    return true;
  } catch {
    return false;
  }
};

class BlockTransactionContext implements BlockTransaction {
  private readonly egWalker: EgWalkerReplica;
  private readonly baseEvents: ReadonlyArray<RichTextEvent>;
  private readonly events: RichTextEvent[] = [];
  private readonly initialParentVersion: ReadonlyArray<string>;
  private state: MaterializedBlockState;

  constructor(
    replicaId: string,
    source: EgWalkerReplica,
    baseEvents: ReadonlyArray<RichTextEvent>,
  ) {
    this.egWalker = EgWalkerReplica.fromEventGraph(
      replicaId,
      source.exportEventGraph(),
    );
    this.baseEvents = baseEvents;
    this.initialParentVersion = [...this.egWalker.getFrontier()].sort(
      compareIds,
    );
    this.state = materializeBlockState(this.egWalker, baseEvents);
  }

  insertText(blockId: BlockId, offset: number, text: string): void {
    if (text.length === 0) {
      return;
    }
    const projected = requireProjectedBlock(this.state, blockId);
    const rawIndex = rawBoundary(projected, offset);
    const encoded = encodeText(text);
    const graphEvent = this.egWalker.insert(rawIndex, encoded);
    if (graphEvent === null) {
      throw new Error("EG-walker rejected a non-empty encoded text insert");
    }
    this.pushEvent(graphEvent, { type: "text-insert", blockId, text });
  }

  deleteText(blockId: BlockId, from: number, to: number): void {
    const projected = requireProjectedBlock(this.state, blockId);
    rawBoundary(projected, from);
    rawBoundary(projected, to);
    if (from > to) {
      throw new Error("Text delete range must be forward");
    }
    if (from === to) {
      return;
    }
    const units = projected.units.filter(
      (unit) => from <= unit.from && unit.to <= to,
    );
    if (
      units.length === 0 ||
      units[0]!.from !== from ||
      units.at(-1)!.to !== to
    ) {
      throw new Error("Text delete range must align to UTF-16 boundaries");
    }
    const groups = contiguousRawGroups(units).reverse();
    for (const group of groups) {
      const graphEvent = this.egWalker.delete(
        group.start,
        group.end - group.start,
      );
      if (graphEvent === null) {
        throw new Error("EG-walker rejected a non-empty text delete");
      }
      this.events.push(
        fromGraphEvent(graphEvent, { type: "text-delete", blockId }),
      );
    }
    this.refresh();
  }

  insertBlock(afterBlockId: BlockId | null, input: BlockInput): BlockId {
    assertBlockInput(input);
    const after =
      afterBlockId === null
        ? this.state.projectedBlocks[0]
        : requireProjectedBlock(this.state, afterBlockId);
    if (after === undefined) {
      throw new Error("Cannot insert a block into an empty projection");
    }
    const rawIndex = after.rawEnd;
    const graphEvent = this.egWalker.insert(rawIndex, BLOCK_MARKER);
    if (graphEvent === null) {
      throw new Error("EG-walker rejected a block marker insert");
    }
    const blockId = input.id ?? graphEvent.id;
    this.assertUnusedBlockId(blockId);
    this.events.push(
      fromGraphEvent(graphEvent, {
        type: "block-create",
        blockId,
        sourceBlockId: null,
        fields: normalizeFields(input.type, input.attrs),
      }),
    );
    this.refresh();
    if (input.text.length > 0) {
      this.insertText(blockId, 0, input.text);
    }
    for (const mark of input.marks ?? []) {
      this.applyInputMark(blockId, mark);
    }
    return blockId;
  }

  splitBlock(
    blockId: BlockId,
    offset: number,
    fields: BlockFieldPatch = {},
    preferredBlockId?: BlockId,
  ): BlockId {
    assertFieldPatch(fields);
    const source = requireProjectedBlock(this.state, blockId);
    const rawIndex = rawBoundary(source, offset);
    const graphEvent = this.egWalker.insert(rawIndex, BLOCK_MARKER);
    if (graphEvent === null) {
      throw new Error("EG-walker rejected a split marker insert");
    }
    const newBlockId = preferredBlockId ?? graphEvent.id;
    this.assertUnusedBlockId(newBlockId);
    this.events.push(
      fromGraphEvent(graphEvent, {
        type: "block-create",
        blockId: newBlockId,
        sourceBlockId: blockId,
        fields: normalizeFields(fields.type ?? source.block.type, {
          ...source.block.attrs,
          ...fields,
        }),
      }),
    );
    this.refresh();
    return newBlockId;
  }

  joinBlock(blockId: BlockId): void {
    if (blockId === BOOTSTRAP_BLOCK_ID) {
      throw new Error("The bootstrap block cannot be joined");
    }
    const projected = requireProjectedBlock(this.state, blockId);
    const index = this.state.projectedBlocks.indexOf(projected);
    if (index <= 0) {
      throw new Error("The first visible block cannot be joined");
    }
    this.pushMetadata({ type: "block-join", blockId });
  }

  deleteBlock(blockId: BlockId): void {
    if (blockId === BOOTSTRAP_BLOCK_ID) {
      throw new Error("The bootstrap block cannot be deleted");
    }
    requireProjectedBlock(this.state, blockId);
    this.pushMetadata({ type: "block-delete", blockId });
  }

  setBlock(blockId: BlockId, fields: BlockFieldPatch): void {
    requireProjectedBlock(this.state, blockId);
    assertFieldPatch(fields);
    if (Object.keys(fields).length === 0) {
      return;
    }
    this.pushMetadata({ type: "block-set", blockId, fields: { ...fields } });
  }

  setMark(
    blockId: BlockId,
    from: number,
    to: number,
    kind: MarkKind,
    value: true | LinkAttributes | null,
    affinity: MarkBoundaryAffinity = defaultMarkAffinity(kind),
  ): void {
    if (!isMarkKind(kind)) {
      throw new Error(`Unsupported mark kind ${String(kind)}`);
    }
    assertMarkValue(kind, value);
    const projected = requireProjectedBlock(this.state, blockId);
    const rawFrom = rawBoundary(projected, from);
    const rawTo = rawBoundary(projected, to);
    if (from >= to || rawFrom >= rawTo) {
      if (from === to) {
        return;
      }
      throw new Error("Mark range must be non-empty and forward");
    }
    const projection = createSequenceAnchorProjection(this.egWalker);
    const range = {
      start: projection.captureAnchor(rawFrom, affinity.start),
      end: projection.captureAnchor(rawTo, affinity.end),
    };
    this.pushMetadata({ type: "mark-set", blockId, kind, value, range });
  }

  replaceDocument(next: BlockDocumentInput): ReadonlyArray<BlockId> {
    if (!Array.isArray(next.blocks) || next.blocks.length === 0) {
      throw new Error("A block document must contain at least one block");
    }
    next.blocks.forEach(assertBlockInput);
    const before = this.state.document.blocks;
    const existingIndex = new Map(
      before.map((block, index) => [block.id, index]),
    );
    const selectedIds: BlockId[] = [];
    const inputIds = new Map<string, BlockId>();
    let lastExistingIndex = -1;

    for (let index = 0; index < next.blocks.length; index++) {
      const input = next.blocks[index]!;
      let stableId: BlockId;
      const knownIndex = input.id ? existingIndex.get(input.id) : undefined;
      if (index === 0) {
        const first = this.state.document.blocks[0]!;
        if (input.id !== undefined && input.id !== first.id) {
          throw new Error(
            `replaceDocument cannot replace first block ID ${first.id} with ${input.id}`,
          );
        }
        stableId = first.id;
        lastExistingIndex = 0;
      } else if (knownIndex !== undefined) {
        if (knownIndex <= lastExistingIndex) {
          throw new Error("replaceDocument does not support block reordering");
        }
        stableId = input.id!;
        lastExistingIndex = knownIndex;
      } else {
        stableId = this.insertBlock(selectedIds.at(-1)!, {
          ...input,
          text: "",
          attrs: { ...input.attrs, parentId: null },
          marks: [],
        });
      }
      if (selectedIds.includes(stableId)) {
        throw new Error(`replaceDocument contains duplicate block ${stableId}`);
      }
      selectedIds.push(stableId);
      if (input.inputId !== undefined) {
        if (inputIds.has(input.inputId)) {
          throw new Error(`Duplicate transaction inputId ${input.inputId}`);
        }
        inputIds.set(input.inputId, stableId);
      }
    }

    for (const block of before) {
      if (block.id !== BOOTSTRAP_BLOCK_ID && !selectedIds.includes(block.id)) {
        this.deleteBlock(block.id);
      }
    }

    for (let index = 0; index < next.blocks.length; index++) {
      const input = next.blocks[index]!;
      const stableId = selectedIds[index]!;
      const parentId = resolveInputParent(input, inputIds);
      const current = requireBlock(this.state.document, stableId);
      const desiredFields = normalizeFields(input.type, {
        ...input.attrs,
        parentId,
      });
      if (
        current.type !== desiredFields.type ||
        !sameBlockAttributes(current.attrs, desiredFields)
      ) {
        this.setBlock(stableId, desiredFields);
      }
      const textChange = diffText(current.text, input.text);
      if (textChange !== null) {
        if (textChange.from < textChange.oldTo) {
          this.deleteText(stableId, textChange.from, textChange.oldTo);
        }
        if (textChange.insert.length > 0) {
          this.insertText(stableId, textChange.from, textChange.insert);
        }
      }
      const refreshed = requireBlock(this.state.document, stableId);
      const desiredMarks = input.marks ?? [];
      if (!sameMarks(refreshed.marks, desiredMarks)) {
        for (const mark of refreshed.marks) {
          this.setMark(stableId, mark.from, mark.to, mark.kind, null);
        }
        for (const mark of desiredMarks) {
          this.applyInputMark(stableId, mark);
        }
      }
    }
    return Object.freeze(selectedIds);
  }

  finish(): RichTextEventBatch | null {
    if (this.events.length === 0) {
      return null;
    }
    return parseBatch({
      schemaVersion: BLOCK_MODEL_SCHEMA_VERSION,
      batchId: this.events[0]!.id,
      parentVersion: this.initialParentVersion,
      events: this.events,
    });
  }

  private pushMetadata(effect: RichTextEffect): void {
    const graphEvent = this.egWalker.insert(
      this.egWalker.getText().length,
      METADATA_MARKER,
    );
    if (graphEvent === null) {
      throw new Error("EG-walker rejected a metadata carrier insert");
    }
    this.pushEvent(graphEvent, effect);
  }

  private pushEvent(graphEvent: GraphEvent, effect: RichTextEffect): void {
    this.events.push(fromGraphEvent(graphEvent, effect));
    this.refresh();
  }

  private refresh(): void {
    this.state = materializeBlockState(this.egWalker, [
      ...this.baseEvents,
      ...this.events,
    ]);
  }

  private assertUnusedBlockId(blockId: string): void {
    if (blockId.length === 0) {
      throw new Error("Block ID cannot be empty");
    }
    const exists = [...this.baseEvents, ...this.events].some((event) => {
      const effect = event.effect;
      return (
        (effect.type === "bootstrap" || effect.type === "block-create") &&
        effect.blockId === blockId
      );
    });
    if (exists) {
      throw new Error(`Duplicate block ID ${blockId}`);
    }
  }

  private applyInputMark(blockId: BlockId, mark: MarkSpan): void {
    if (!isMarkKind(mark.kind)) {
      throw new Error(`Unsupported mark kind ${String(mark.kind)}`);
    }
    this.setMark(blockId, mark.from, mark.to, mark.kind, mark.value);
  }
}

interface RebuiltReplica {
  readonly egWalker: EgWalkerReplica;
  readonly integratedBatchIds: Set<string>;
  readonly state: MaterializedBlockState;
}

const rebuildReplica = (
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

const eventOwners = (
  batches: ReadonlyMap<string, RichTextEventBatch>,
): Map<string, string> => {
  const owners = new Map<string, string>();
  for (const batch of batches.values()) {
    for (const event of batch.events) {
      const existing = owners.get(event.id);
      if (existing !== undefined && existing !== batch.batchId) {
        throw new Error(`Event ID ${event.id} belongs to multiple batches`);
      }
      owners.set(event.id, batch.batchId);
    }
  }
  return owners;
};

const integratedEvents = (
  batches: ReadonlyMap<string, RichTextEventBatch>,
  integrated: ReadonlySet<string>,
): ReadonlyArray<RichTextEvent> =>
  readyBatches(batches)
    .filter((batch) => integrated.has(batch.batchId))
    .flatMap((batch) => [...batch.events]);

const requireProjectedBlock = (
  state: MaterializedBlockState,
  blockId: BlockId,
): ProjectedBlock => {
  const projected = state.projectedBlocks.find(
    ({ block }) => block.id === blockId,
  );
  if (projected === undefined) {
    throw new Error(`Unknown or hidden block ${blockId}`);
  }
  return projected;
};

const requireBlock = (document: BlockDocument, blockId: BlockId): Block => {
  const block = document.blocks.find(({ id }) => id === blockId);
  if (block === undefined) {
    throw new Error(`Unknown or hidden block ${blockId}`);
  }
  return block;
};

const rawBoundary = (projected: ProjectedBlock, offset: number): number => {
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw new Error("Block offset must be a non-negative safe integer");
  }
  const rawIndex = projected.boundaries.get(offset);
  if (rawIndex === undefined) {
    throw new Error(
      `Block offset ${offset} is out of range or splits a surrogate pair`,
    );
  }
  return rawIndex;
};

const contiguousRawGroups = (
  units: ReadonlyArray<{
    readonly rawFrom: number;
    readonly rawTo: number;
  }>,
): Array<{ readonly start: number; readonly end: number }> => {
  const groups: Array<{ start: number; end: number }> = [];
  for (const unit of units) {
    const previous = groups.at(-1);
    if (previous !== undefined && previous.end === unit.rawFrom) {
      previous.end = unit.rawTo;
    } else {
      groups.push({ start: unit.rawFrom, end: unit.rawTo });
    }
  }
  return groups;
};

const defaultMarkAffinity = (kind: MarkKind): MarkBoundaryAffinity =>
  kind === "link"
    ? { start: "before", end: "after" }
    : { start: "after", end: "before" };

const assertMarkValue = (
  kind: MarkKind,
  value: true | LinkAttributes | null,
): void => {
  if (value === null) {
    return;
  }
  if (kind === "link") {
    if (!isLinkAttributes(value)) {
      throw new Error("Link marks require structured link attributes");
    }
  } else if (value !== true) {
    throw new Error(`${kind} marks require true or null`);
  }
};

const assertBlockInput = (input: BlockInput): void => {
  if (!isBlockType(input.type)) {
    throw new Error(`Unsupported block type ${String(input.type)}`);
  }
  if (input.id !== undefined && input.id.length === 0) {
    throw new Error("Block ID cannot be empty");
  }
  if (input.inputId !== undefined && input.inputId.length === 0) {
    throw new Error("inputId cannot be empty");
  }
  if (input.parentInputId !== undefined && input.parentInputId === "") {
    throw new Error("parentInputId cannot be empty");
  }
  assertFieldPatch(input.attrs ?? {});
  encodeText(input.text);
  for (const mark of input.marks ?? []) {
    if (!isMarkKind(mark.kind)) {
      throw new Error(`Unsupported mark kind ${String(mark.kind)}`);
    }
    assertMarkValue(mark.kind, mark.value);
    if (
      !Number.isSafeInteger(mark.from) ||
      !Number.isSafeInteger(mark.to) ||
      mark.from < 0 ||
      mark.from >= mark.to ||
      mark.to > input.text.length
    ) {
      throw new Error("Input mark range is invalid");
    }
  }
};

const resolveInputParent = (
  input: BlockInput,
  inputIds: ReadonlyMap<string, BlockId>,
): BlockId | null => {
  if (input.parentInputId === null) {
    return null;
  }
  if (input.parentInputId !== undefined) {
    const parent = inputIds.get(input.parentInputId);
    if (parent === undefined) {
      throw new Error(
        `Unknown or forward parentInputId ${input.parentInputId}`,
      );
    }
    return parent;
  }
  return input.attrs?.parentId ?? null;
};

const sameBlockAttributes = (
  left: Block["attrs"],
  right: Block["attrs"],
): boolean =>
  left.parentId === right.parentId &&
  left.language === right.language &&
  left.theme === right.theme &&
  left.start === right.start &&
  left.value === right.value &&
  left.checked === right.checked;

const sameLinkAttributes = (
  left: LinkAttributes,
  right: LinkAttributes,
): boolean =>
  left.url === right.url &&
  left.target === right.target &&
  left.rel === right.rel &&
  left.title === right.title;

const sameMarkSpan = (left: MarkSpan, right: MarkSpan): boolean =>
  left.kind === right.kind &&
  left.from === right.from &&
  left.to === right.to &&
  (left.kind === "link"
    ? sameLinkAttributes(
        left.value as LinkAttributes,
        right.value as LinkAttributes,
      )
    : left.value === right.value);

const sameMarks = (
  left: ReadonlyArray<MarkSpan>,
  right: ReadonlyArray<MarkSpan>,
): boolean =>
  left.length === right.length &&
  left.every((mark, index) => sameMarkSpan(mark, right[index]!));

interface TextChange {
  readonly from: number;
  readonly oldTo: number;
  readonly insert: string;
}

const diffText = (before: string, after: string): TextChange | null => {
  if (before === after) {
    return null;
  }
  const beforePoints = Array.from(before);
  const afterPoints = Array.from(after);
  let prefixCount = 0;
  while (
    prefixCount < beforePoints.length &&
    prefixCount < afterPoints.length &&
    beforePoints[prefixCount] === afterPoints[prefixCount]
  ) {
    prefixCount++;
  }
  let suffixCount = 0;
  while (
    suffixCount < beforePoints.length - prefixCount &&
    suffixCount < afterPoints.length - prefixCount &&
    beforePoints[beforePoints.length - suffixCount - 1] ===
      afterPoints[afterPoints.length - suffixCount - 1]
  ) {
    suffixCount++;
  }
  const from = beforePoints.slice(0, prefixCount).join("").length;
  const oldSuffixLength = beforePoints
    .slice(beforePoints.length - suffixCount)
    .join("").length;
  const newSuffixLength = afterPoints
    .slice(afterPoints.length - suffixCount)
    .join("").length;
  return {
    from,
    oldTo: before.length - oldSuffixLength,
    insert: after.slice(from, after.length - newSuffixLength),
  };
};

const resolveRawAnchor = (
  egWalker: EgWalkerReplica,
  anchor: BlockAnchor,
): number => {
  // Kept behind a tiny helper so a future batch resolver can replace the
  // current on-demand EG replay without changing the public block API.
  return resolveAnchor(egWalker, anchor.anchor);
};

const tryResolveRawAnchor = (
  egWalker: EgWalkerReplica,
  anchor: BlockAnchor,
): number | null => tryResolveAnchor(egWalker, anchor.anchor);

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
