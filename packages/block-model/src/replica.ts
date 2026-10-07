import type { GraphEvent } from "@softmaple/eg-walker";
import type { AnchorAffinity } from "@softmaple/eg-walker/anchors";

import {
  BLOCK_MARKER,
  BLOCK_MODEL_SCHEMA_VERSION,
  BOOTSTRAP_BATCH_ID,
  BOOTSTRAP_BLOCK_ID,
  METADATA_MARKER,
} from "./constants";
import { ReplicaState } from "./replica-state";
import { diffText, type TextChange } from "./text-diff";
import type {
  ApplyRichTextEventsResult,
  Block,
  BlockAnchor,
  BlockAttributePatch,
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
  assertWellFormedUtf16,
  BOOTSTRAP_BATCH,
  cloneBatch,
  compareIds,
  encodeText,
  isBlockType,
  isLinkAttributes,
  isMarkKind,
  normalizeFields,
  parseBatch,
  sameBatch,
} from "./wire";

interface PendingBatch {
  readonly batch: RichTextEventBatch;
  /** A parent event of the batch that is not integrated yet. */
  readonly missing: string;
}

interface IntegrationPlan {
  /** Batches that become ready, in causal order. */
  readonly ready: ReadonlyArray<RichTextEventBatch>;
  /** Batches that stay or become pending, keyed by batch ID. */
  readonly parked: ReadonlyMap<string, PendingBatch>;
}

export class BlockReplica {
  private state: ReplicaState;
  private readonly batchesById = new Map<string, RichTextEventBatch>([
    [BOOTSTRAP_BATCH_ID, BOOTSTRAP_BATCH],
  ]);
  private readonly eventOwner = new Map<string, string>(
    BOOTSTRAP_BATCH.events.map((event) => [event.id, BOOTSTRAP_BATCH_ID]),
  );
  /** Integrated non-bootstrap batches, in the causal order they were applied. */
  private readonly integrated: RichTextEventBatch[] = [];
  private readonly pending = new Map<string, PendingBatch>();
  /** Pending batch IDs keyed by the missing event they wait for. */
  private readonly waiting = new Map<string, Set<string>>();
  private readonly listeners = new Set<BlockReplicaListener>();

  constructor(private readonly replicaId: string) {
    if (replicaId.length === 0) {
      throw new Error("Block replica ID cannot be empty");
    }
    this.state = new ReplicaState(replicaId);
  }

  transact(
    callback: (transaction: BlockTransaction) => void,
  ): RichTextEventBatch | null {
    const context = new BlockTransactionContext(this.state);
    let batch: RichTextEventBatch | null;
    try {
      callback(context);
      batch = context.finish();
    } catch (error) {
      if (context.mutated) {
        this.state = this.rebuildState();
      }
      throw error;
    }
    if (batch === null) {
      return null;
    }

    // A pending batch can wait for an event ID this replica just produced.
    const plan = this.planIntegration(
      [],
      batch.events.map(({ id }) => id),
    );
    this.integrateReady(plan);
    this.commit([batch], [batch, ...plan.ready], plan);
    this.notify("local", [batch.batchId]);
    return cloneBatch(batch);
  }

  applyRemoteEvents(
    input: RichTextEventBatch | ReadonlyArray<RichTextEventBatch>,
  ): ApplyRichTextEventsResult {
    const incoming = (Array.isArray(input) ? input : [input]).map((batch) =>
      parseBatch(batch),
    );
    const staged = new Map<string, RichTextEventBatch>();
    const stagedOwners = new Map<string, string>();

    for (const batch of incoming) {
      const existing =
        this.batchesById.get(batch.batchId) ?? staged.get(batch.batchId);
      if (existing !== undefined) {
        if (!sameBatch(existing, batch)) {
          throw new Error(`Conflicting batch ID ${batch.batchId}`);
        }
        continue;
      }
      for (const event of batch.events) {
        const owner =
          this.eventOwner.get(event.id) ?? stagedOwners.get(event.id);
        if (owner !== undefined) {
          throw new Error(
            `Event ID ${event.id} already belongs to batch ${owner}`,
          );
        }
        stagedOwners.set(event.id, batch.batchId);
      }
      staged.set(batch.batchId, batch);
    }

    const plan = this.planIntegration([...staged.values()], []);
    this.integrateReady(plan);
    this.commit([...staged.values()], plan.ready, plan);
    const newlyIntegrated = plan.ready
      .map(({ batchId }) => batchId)
      .sort(compareIds);
    if (newlyIntegrated.length > 0) {
      this.notify("remote", newlyIntegrated);
    }
    return Object.freeze({
      integratedBatchIds: Object.freeze(newlyIntegrated),
      pendingBatchIds: Object.freeze([...this.pending.keys()].sort(compareIds)),
    });
  }

  getDocument(): BlockDocument {
    return this.state.document();
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
    return this.state.captureBlockAnchor(blockId, offset, affinity);
  }

  resolveBlockAnchor(anchor: BlockAnchor): ResolvedBlockAnchor {
    return this.state.resolveBlockAnchor(anchor);
  }

  /**
   * Resolve a block anchor, or return `null` when the underlying sequence atom
   * has not been integrated yet. Invalid anchors still throw.
   */
  tryResolveBlockAnchor(anchor: BlockAnchor): ResolvedBlockAnchor | null {
    return this.state.tryResolveBlockAnchor(anchor);
  }

  /**
   * Decide which batches become ready, without touching replica state.
   * `integratedEventIds` are events that just became available locally.
   */
  private planIntegration(
    staged: ReadonlyArray<RichTextEventBatch>,
    integratedEventIds: ReadonlyArray<string>,
  ): IntegrationPlan {
    const ready: RichTextEventBatch[] = [];
    const parked = new Map<string, PendingBatch>();
    const parkedByMissing = new Map<string, string[]>();
    const planned = new Set<string>();
    const woken = [...integratedEventIds];

    const evaluate = (batch: RichTextEventBatch): void => {
      const missing = batch.parentVersion.find(
        (parent) => !this.state.hasEvent(parent) && !planned.has(parent),
      );
      if (missing === undefined) {
        ready.push(batch);
        parked.delete(batch.batchId);
        for (const event of batch.events) {
          planned.add(event.id);
          woken.push(event.id);
        }
        return;
      }
      parked.set(batch.batchId, { batch, missing });
      const waiters = parkedByMissing.get(missing);
      if (waiters === undefined) {
        parkedByMissing.set(missing, [batch.batchId]);
      } else {
        waiters.push(batch.batchId);
      }
    };

    staged.forEach(evaluate);
    while (woken.length > 0) {
      const eventId = woken.pop()!;
      const waiters = [
        ...[...(this.waiting.get(eventId) ?? [])].map(
          (batchId) => this.pending.get(batchId)!.batch,
        ),
        ...(parkedByMissing.get(eventId) ?? []).map(
          (batchId) => parked.get(batchId)!.batch,
        ),
      ];
      parkedByMissing.delete(eventId);
      waiters.forEach(evaluate);
    }
    return { ready, parked };
  }

  private integrateReady(plan: IntegrationPlan): void {
    if (plan.ready.length === 0) {
      return;
    }
    try {
      this.state.integrateBatches(plan.ready);
    } catch (error) {
      this.state = this.rebuildState();
      throw error;
    }
  }

  private commit(
    stored: ReadonlyArray<RichTextEventBatch>,
    integrated: ReadonlyArray<RichTextEventBatch>,
    plan: IntegrationPlan,
  ): void {
    for (const batch of stored) {
      this.batchesById.set(batch.batchId, batch);
      for (const event of batch.events) {
        this.eventOwner.set(event.id, batch.batchId);
      }
    }
    // Spreading into `push` passes one argument per batch on the stack, which
    // overflows for a large delivery after the state already integrated it.
    for (const batch of integrated) {
      this.integrated.push(batch);
    }
    for (const batch of plan.ready) {
      this.unpark(batch.batchId);
    }
    for (const [batchId, entry] of plan.parked) {
      this.unpark(batchId);
      this.pending.set(batchId, entry);
      const waiters = this.waiting.get(entry.missing);
      if (waiters === undefined) {
        this.waiting.set(entry.missing, new Set([batchId]));
      } else {
        waiters.add(batchId);
      }
    }
  }

  private unpark(batchId: string): void {
    const entry = this.pending.get(batchId);
    if (entry === undefined) {
      return;
    }
    this.pending.delete(batchId);
    const waiters = this.waiting.get(entry.missing);
    waiters?.delete(batchId);
    if (waiters?.size === 0) {
      this.waiting.delete(entry.missing);
    }
  }

  /** Recover from a failed update by replaying the committed batches. */
  private rebuildState(): ReplicaState {
    const state = new ReplicaState(this.replicaId);
    if (this.integrated.length > 0) {
      state.integrateBatches(this.integrated);
    }
    return state;
  }

  private notify(origin: "local" | "remote", batchIds: string[]): void {
    if (this.listeners.size === 0) {
      return;
    }
    const change = Object.freeze({
      origin,
      batchIds: Object.freeze([...batchIds]),
      document: this.state.document(),
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

/**
 * Applies operations straight to the replica's long-lived state. If the
 * callback throws after touching EG-walker, the owner rebuilds its state from
 * the committed batches, so a failed transaction still leaves no trace.
 *
 * An edit that throws after it reached EG-walker leaves the shared state
 * half-applied, so it spoils the transaction even if the callback catches the
 * error: every later call and `finish` rethrow it, and the owner rebuilds.
 */
class BlockTransactionContext implements BlockTransaction {
  private readonly events: RichTextEvent[] = [];
  private readonly initialParentVersion: ReadonlyArray<string>;
  private failure: { readonly error: unknown } | null = null;
  /** Whether EG-walker may have been modified by this transaction. */
  mutated = false;

  constructor(private readonly state: ReplicaState) {
    this.initialParentVersion = state.frontier();
  }

  insertText(blockId: BlockId, offset: number, text: string): void {
    this.assertUsable();
    if (text.length === 0) {
      return;
    }
    const projected = this.state.requireVisibleBlock(blockId);
    const rawIndex = this.state.rawBoundary(projected, offset);
    const encoded = encodeText(text);
    this.insertRaw(
      rawIndex,
      encoded,
      () => ({ type: "text-insert", blockId, text }),
      "EG-walker rejected a non-empty encoded text insert",
    );
  }

  deleteText(blockId: BlockId, from: number, to: number): void {
    this.assertUsable();
    const projected = this.state.requireVisibleBlock(blockId);
    this.state.rawBoundary(projected, from);
    this.state.rawBoundary(projected, to);
    if (from > to) {
      throw new Error("Text delete range must be forward");
    }
    if (from === to) {
      return;
    }
    const ranges = this.state.deleteRanges(projected, from, to);
    if (ranges.length === 0) {
      throw new Error("Text delete range must align to UTF-16 boundaries");
    }
    // Delete from the end so earlier raw indexes stay valid.
    for (const range of [...ranges].reverse()) {
      this.edit(() =>
        this.state.delete(
          range.start,
          range.end - range.start,
          { type: "text-delete", blockId },
          "EG-walker rejected a non-empty text delete",
        ),
      );
    }
  }

  insertBlock(afterBlockId: BlockId | null, input: BlockInput): BlockId {
    this.assertUsable();
    assertBlockInput(input);
    assertWellFormedUtf16(input.text, "text");
    const after =
      afterBlockId === null
        ? this.state.firstVisibleBlock()
        : this.state.requireVisibleBlock(afterBlockId);
    if (after === undefined) {
      throw new Error("Cannot insert a block into an empty projection");
    }
    if (input.id !== undefined) {
      this.assertUnusedBlockId(input.id);
    }
    let blockId = "";
    this.insertRaw(
      this.state.rawEnd(after),
      BLOCK_MARKER,
      (graphEvent) => {
        blockId = input.id ?? graphEvent.id;
        this.assertUnusedBlockId(blockId);
        return {
          type: "block-create",
          blockId,
          sourceBlockId: null,
          fields: normalizeFields(input.type, input.attrs),
        };
      },
      "EG-walker rejected a block marker insert",
    );
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
    this.assertUsable();
    assertFieldPatch(fields);
    const projected = this.state.requireVisibleBlock(blockId);
    const source = projected.block;
    const rawIndex = this.state.rawBoundary(projected, offset);
    if (preferredBlockId !== undefined) {
      this.assertUnusedBlockId(preferredBlockId);
    }
    let newBlockId = "";
    this.insertRaw(
      rawIndex,
      BLOCK_MARKER,
      (graphEvent) => {
        newBlockId = preferredBlockId ?? graphEvent.id;
        this.assertUnusedBlockId(newBlockId);
        return {
          type: "block-create",
          blockId: newBlockId,
          sourceBlockId: blockId,
          fields: normalizeFields(fields.type ?? source.type, {
            ...source.attrs,
            ...fields,
          }),
        };
      },
      "EG-walker rejected a split marker insert",
    );
    return newBlockId;
  }

  joinBlock(blockId: BlockId): void {
    this.assertUsable();
    if (blockId === BOOTSTRAP_BLOCK_ID) {
      throw new Error("The bootstrap block cannot be joined");
    }
    if (this.state.requireVisibleBlock(blockId).index <= 0) {
      throw new Error("The first visible block cannot be joined");
    }
    this.pushMetadata({ type: "block-join", blockId });
  }

  deleteBlock(blockId: BlockId): void {
    this.assertUsable();
    if (blockId === BOOTSTRAP_BLOCK_ID) {
      throw new Error("The bootstrap block cannot be deleted");
    }
    this.state.requireVisibleBlock(blockId);
    this.pushMetadata({ type: "block-delete", blockId });
  }

  setBlock(blockId: BlockId, fields: BlockFieldPatch): void {
    this.assertUsable();
    this.state.requireVisibleBlock(blockId);
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
    this.assertUsable();
    if (!isMarkKind(kind)) {
      throw new Error(`Unsupported mark kind ${String(kind)}`);
    }
    assertMarkValue(kind, value);
    const projected = this.state.requireVisibleBlock(blockId);
    const rawFrom = this.state.rawBoundary(projected, from);
    const rawTo = this.state.rawBoundary(projected, to);
    if (from >= to || rawFrom >= rawTo) {
      if (from === to) {
        return;
      }
      throw new Error("Mark range must be non-empty and forward");
    }
    const range = {
      start: this.state.captureAnchor(rawFrom, affinity.start),
      end: this.state.captureAnchor(rawTo, affinity.end),
    };
    this.pushMetadata({ type: "mark-set", blockId, kind, value, range });
  }

  replaceDocument(next: BlockDocumentInput): ReadonlyArray<BlockId> {
    this.assertUsable();
    if (!Array.isArray(next.blocks) || next.blocks.length === 0) {
      throw new Error("A block document must contain at least one block");
    }
    next.blocks.forEach(assertBlockInput);
    const before = this.state.document().blocks;
    const knownIndexes = this.findKnownBlocks(next.blocks, before);
    const textPlans = next.blocks.map((input, index) => {
      const knownIndex = knownIndexes[index];
      return planText(
        knownIndex === undefined ? "" : before[knownIndex]!.text,
        input.text,
      );
    });
    const eventsBefore = this.events.length;
    const selectedIds: BlockId[] = [];
    const kept = before.map(() => false);
    const inputIds = new Map<string, BlockId>();
    let lastExistingIndex = -1;

    for (let index = 0; index < next.blocks.length; index++) {
      const input = next.blocks[index]!;
      let stableId: BlockId;
      const knownIndex = knownIndexes[index];
      if (index === 0) {
        const first = before[0]!;
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
      // Kept indexes only increase and new blocks get unused IDs, so no
      // block is selected twice.
      if (knownIndex !== undefined) {
        kept[knownIndex] = true;
      }
      selectedIds.push(stableId);
      if (input.inputId !== undefined) {
        if (inputIds.has(input.inputId)) {
          throw new Error(`Duplicate transaction inputId ${input.inputId}`);
        }
        inputIds.set(input.inputId, stableId);
      }
    }

    before.forEach((block, index) => {
      if (!kept[index] && block.id !== BOOTSTRAP_BLOCK_ID) {
        this.deleteBlock(block.id);
      }
    });

    for (let index = 0; index < next.blocks.length; index++) {
      const input = next.blocks[index]!;
      const stableId = selectedIds[index]!;
      const knownIndex = knownIndexes[index];
      // `before` stays current until this replacement edits something.
      const current =
        knownIndex !== undefined && this.events.length === eventsBefore
          ? before[knownIndex]!
          : this.requireBlock(stableId);
      this.updateBlock(
        current,
        input,
        resolveInputParent(input, inputIds),
        textPlans[index]!,
      );
    }
    return Object.freeze(selectedIds);
  }

  /** Bring a block's fields, text and marks in line with its input. */
  private updateBlock(
    current: Block,
    input: BlockInput,
    parentId: BlockId | null,
    plan: TextPlan,
  ): void {
    const blockId = current.id;
    let edited = false;
    if (
      current.type !== input.type ||
      !sameBlockAttributes(current.attrs, input.attrs, parentId)
    ) {
      this.setBlock(
        blockId,
        normalizeFields(input.type, { ...input.attrs, parentId }),
      );
      edited = true;
    }
    // Deleting a block moves the text joined into it to the block before it,
    // so diff again when the text is no longer the one planned against.
    const textChange =
      current.text === plan.base
        ? plan.change
        : diffText(current.text, input.text);
    if (textChange !== null) {
      if (textChange.from < textChange.oldTo) {
        this.deleteText(blockId, textChange.from, textChange.oldTo);
      }
      if (textChange.insert.length > 0) {
        this.insertText(blockId, textChange.from, textChange.insert);
      }
      edited = true;
    }
    const { marks } = edited ? this.requireBlock(blockId) : current;
    const desiredMarks = input.marks ?? [];
    if (!sameMarks(marks, desiredMarks)) {
      for (const mark of marks) {
        this.setMark(blockId, mark.from, mark.to, mark.kind, null);
      }
      for (const mark of desiredMarks) {
        this.applyInputMark(blockId, mark);
      }
    }
  }

  finish(): RichTextEventBatch | null {
    this.assertUsable();
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
    this.insertRaw(
      this.state.rawLength(),
      METADATA_MARKER,
      () => effect,
      "EG-walker rejected a metadata carrier insert",
    );
  }

  private insertRaw(
    rawIndex: number,
    text: string,
    effectFor: (graphEvent: GraphEvent) => RichTextEffect,
    rejection: string,
  ): void {
    this.edit(() => this.state.insert(rawIndex, text, effectFor, rejection));
  }

  /** Apply one edit to the shared state, spoiling the transaction on error. */
  private edit(apply: () => RichTextEvent): void {
    this.assertUsable();
    this.mutated = true;
    try {
      this.events.push(apply());
    } catch (error) {
      this.failure = { error };
      throw error;
    }
  }

  private assertUsable(): void {
    if (this.failure !== null) {
      throw this.failure.error;
    }
  }

  private requireBlock(blockId: BlockId): Block {
    return this.state.requireVisibleBlock(blockId).block;
  }

  /**
   * Index in `before` of the block each input keeps, or `undefined` for a new
   * block. The first input always keeps the first block. Inputs usually keep
   * the blocks in order, so the block after the previous match is checked
   * before the ID is looked up.
   */
  private findKnownBlocks(
    inputs: ReadonlyArray<BlockInput>,
    before: ReadonlyArray<Block>,
  ): Array<number | undefined> {
    let previous = 0;
    return inputs.map((input, index) => {
      if (index === 0) {
        return 0;
      }
      if (input.id === undefined) {
        return undefined;
      }
      const knownIndex =
        before[previous + 1]?.id === input.id
          ? previous + 1
          : this.state.visibleBlock(input.id)?.index;
      previous = knownIndex ?? previous;
      return knownIndex;
    });
  }

  private assertUnusedBlockId(blockId: string): void {
    if (blockId.length === 0) {
      throw new Error("Block ID cannot be empty");
    }
    if (this.state.hasBlockMarker(blockId)) {
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

/**
 * Check everything but the text itself: `insertBlock` validates all of it,
 * `replaceDocument` only the parts it inserts.
 */
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

interface TextPlan {
  /** The text the change was computed against. */
  readonly base: string;
  readonly change: TextChange | null;
}

/**
 * Diff a block's text before the transaction edits anything, and check the
 * slice the diff inserts, which is all `insertText` will validate later.
 * Document text is well-formed, since EG-walker rejects edits between
 * surrogate halves, and the diff cuts it only between code points, so a lone
 * surrogate anywhere in `text` ends up in that slice.
 */
const planText = (base: string, text: string): TextPlan => {
  const change = diffText(base, text);
  if (change !== null) {
    assertWellFormedUtf16(change.insert, "text");
  }
  return { base, change };
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

/** Whether `attrs` equal what `normalizeFields` makes of `patch` and `parentId`. */
const sameBlockAttributes = (
  attrs: Block["attrs"],
  patch: BlockAttributePatch | undefined,
  parentId: BlockId | null,
): boolean =>
  attrs.parentId === parentId &&
  attrs.language === (patch?.language ?? null) &&
  attrs.theme === (patch?.theme ?? null) &&
  attrs.start === (patch?.start ?? null) &&
  attrs.value === (patch?.value ?? null) &&
  attrs.checked === (patch?.checked ?? null);

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
