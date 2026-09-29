import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  BLOCK_MARKER,
  BOOTSTRAP_BLOCK_ID,
  BlockReplica,
  METADATA_MARKER,
  TEXT_ESCAPE,
  type Block,
  type BlockAnchor,
  type BlockDocument,
  type BlockTransaction,
  type BlockType,
  type MarkKind,
  type RichTextEventBatch,
} from "../../index";
import {
  captureBlockAnchorFromRebuild,
  rebuildFromBatches,
  tryResolveBlockAnchorFromRebuild,
} from "../rebuild-oracle";

describe("property: incremental block state", () => {
  it("should always equal a full rebuild while local and remote batches interleave", () => {
    fc.assert(
      fc.property(fc.array(stepArbitrary, { minLength: 1 }), (steps) => {
        // Arrange
        const replicas = REPLICA_IDS.map((id) => new BlockReplica(id));
        const anchors: BlockAnchor[] = [];

        for (const step of steps) {
          // Act
          const touched = applyStep(step, replicas, anchors);

          // Assert
          expectMatchesRebuild(touched, anchors);
        }
      }),
      { numRuns: 60 },
    );
  });

  it("should always converge to the rebuilt document after concurrent editing and full delivery", () => {
    fc.assert(
      fc.property(
        fc.array(fc.array(editStepArbitrary, { minLength: 1 }), {
          minLength: 1,
        }),
        (rounds) => {
          // Arrange
          const replicas = REPLICA_IDS.map((id) => new BlockReplica(id));
          const anchors: BlockAnchor[] = [];

          // Act
          for (const round of rounds) {
            for (const step of round) {
              applyStep(step, replicas, anchors);
            }
            deliverEverything(replicas);
          }

          // Assert
          const [first, ...others] = replicas;
          for (const replica of others) {
            expect(replica.getDocument()).toEqual(first!.getDocument());
          }
          for (const replica of replicas) {
            expectMatchesRebuild(replica, anchors);
          }
        },
      ),
      { numRuns: 40 },
    );
  });

  it("should always equal a full rebuild when a long concurrent history arrives at once", () => {
    fc.assert(
      fc.property(
        fc.array(editStepArbitrary, { minLength: 40 }),
        fc.array(fc.nat()),
        (steps, syncPoints) => {
          // Arrange
          const replicas = REPLICA_IDS.map((id) => new BlockReplica(id));
          const syncs = new Set(
            syncPoints.map((point) => point % steps.length),
          );
          steps.forEach((step, index) => {
            applyStep(step, replicas, []);
            if (syncs.has(index)) {
              deliverEverything(replicas);
            }
          });
          deliverEverything(replicas);

          // Act
          const restored = BlockReplica.deserialize(
            replicas[0]!.serialize(),
            "restored",
          );

          // Assert
          expect(restored.getDocument()).toEqual(replicas[0]!.getDocument());
          expectMatchesRebuild(restored, []);
        },
      ),
      { numRuns: 20 },
    );
  });

  it("should always pick the same winner as a full rebuild for overlapping marks", () => {
    fc.assert(
      fc.property(
        fc.array(markConflictArbitrary, { minLength: 2 }),
        fc.array(fc.nat()),
        (marks, deliveryOrder) => {
          // Arrange
          const base = new BlockReplica("base");
          base.transact((transaction) => {
            transaction.insertText(BOOTSTRAP_BLOCK_ID, 0, "concurrent marks");
          });
          const replicas = REPLICA_IDS.map((id) =>
            BlockReplica.deserialize(base.serialize(), id),
          );
          const batches: RichTextEventBatch[] = [];
          for (const mark of marks) {
            const replica = replicas[mark.replica]!;
            if (mark.catchUp) {
              replica.applyRemoteEvents(batches);
            }
            const batch = replica.transact((transaction) => {
              const [from, to] = pickRange(
                "concurrent marks",
                mark.from,
                mark.length,
              );
              transaction.setMark(
                BOOTSTRAP_BLOCK_ID,
                from,
                to,
                mark.kind,
                mark.value === 0
                  ? null
                  : mark.kind === "link"
                    ? { url: `https://softmaple.dev/${mark.value}` }
                    : true,
              );
            });
            if (batch !== null) {
              batches.push(batch);
            }
          }
          const receiver = BlockReplica.deserialize(
            base.serialize(),
            "receiver",
          );

          // Act
          for (const pick of deliveryOrder) {
            receiver.applyRemoteEvents(batches[pick % batches.length]!);
          }
          receiver.applyRemoteEvents(batches);

          // Assert
          expectMatchesRebuild(receiver, []);
        },
      ),
      { numRuns: 60 },
    );
  });
});

// Helpers

const REPLICA_IDS = ["alice", "bob", "carol"] as const;

const BLOCK_TYPES: ReadonlyArray<BlockType> = [
  "paragraph",
  "h1",
  "quote",
  "code",
  "bullet-list",
  "number-list",
  "check-list",
];

const MARK_KINDS: ReadonlyArray<MarkKind> = [
  "bold",
  "italic",
  "underline",
  "strike",
  "inline-code",
  "link",
];

type EditOperation =
  | {
      readonly kind: "insertText";
      readonly block: number;
      readonly offset: number;
      readonly text: string;
    }
  | {
      readonly kind: "deleteText";
      readonly block: number;
      readonly from: number;
      readonly length: number;
    }
  | {
      readonly kind: "insertBlock";
      readonly after: number;
      readonly type: BlockType;
      readonly text: string;
      readonly bold: boolean;
    }
  | {
      readonly kind: "splitBlock";
      readonly block: number;
      readonly offset: number;
      readonly retype: boolean;
      readonly type: BlockType;
    }
  | { readonly kind: "joinBlock"; readonly block: number }
  | { readonly kind: "deleteBlock"; readonly block: number }
  | {
      readonly kind: "setBlock";
      readonly block: number;
      readonly type: BlockType;
      readonly checked: boolean;
      readonly parent: number;
    }
  | {
      readonly kind: "setMark";
      readonly block: number;
      readonly from: number;
      readonly length: number;
      readonly mark: MarkKind;
      readonly clear: boolean;
    }
  | {
      readonly kind: "replaceDocument";
      readonly block: number;
      readonly text: string;
      readonly drop: number;
      readonly add: boolean;
    };

type Step =
  | {
      readonly kind: "edit";
      readonly replica: number;
      readonly operation: EditOperation;
      readonly abort: boolean;
    }
  | {
      readonly kind: "deliver";
      readonly from: number;
      readonly to: number;
      readonly picks: ReadonlyArray<number>;
    }
  | {
      readonly kind: "anchor";
      readonly replica: number;
      readonly block: number;
      readonly offset: number;
      readonly affinity: "before" | "after";
    };

const textArbitrary = fc
  .array(
    fc.constantFrom(
      "a",
      "b",
      " ",
      "\n",
      "é",
      "😀",
      BLOCK_MARKER,
      METADATA_MARKER,
      TEXT_ESCAPE,
    ),
  )
  .map((units) => units.join(""));

const operationArbitrary: fc.Arbitrary<EditOperation> = fc.oneof(
  fc.record({
    kind: fc.constant("insertText" as const),
    block: fc.nat(),
    offset: fc.nat(),
    text: textArbitrary,
  }),
  fc.record({
    kind: fc.constant("deleteText" as const),
    block: fc.nat(),
    from: fc.nat(),
    length: fc.nat(),
  }),
  fc.record({
    kind: fc.constant("insertBlock" as const),
    after: fc.nat(),
    type: fc.constantFrom(...BLOCK_TYPES),
    text: textArbitrary,
    bold: fc.boolean(),
  }),
  fc.record({
    kind: fc.constant("splitBlock" as const),
    block: fc.nat(),
    offset: fc.nat(),
    retype: fc.boolean(),
    type: fc.constantFrom(...BLOCK_TYPES),
  }),
  fc.record({ kind: fc.constant("joinBlock" as const), block: fc.nat() }),
  fc.record({ kind: fc.constant("deleteBlock" as const), block: fc.nat() }),
  fc.record({
    kind: fc.constant("setBlock" as const),
    block: fc.nat(),
    type: fc.constantFrom(...BLOCK_TYPES),
    checked: fc.boolean(),
    parent: fc.nat(),
  }),
  fc.record({
    kind: fc.constant("setMark" as const),
    block: fc.nat(),
    from: fc.nat(),
    length: fc.nat(),
    mark: fc.constantFrom(...MARK_KINDS),
    clear: fc.boolean(),
  }),
  fc.record({
    kind: fc.constant("replaceDocument" as const),
    block: fc.nat(),
    text: textArbitrary,
    drop: fc.nat(),
    add: fc.boolean(),
  }),
);

const markConflictArbitrary = fc.record({
  replica: fc.nat({ max: REPLICA_IDS.length - 1 }),
  kind: fc.constantFrom<MarkKind>("bold", "link"),
  from: fc.nat(),
  length: fc.nat(),
  value: fc.nat({ max: 2 }),
  catchUp: fc.boolean(),
});

const editStepArbitrary: fc.Arbitrary<Step> = fc.record({
  kind: fc.constant("edit" as const),
  replica: fc.nat({ max: REPLICA_IDS.length - 1 }),
  operation: operationArbitrary,
  abort: fc.oneof(
    { weight: 9, arbitrary: fc.constant(false) },
    { weight: 1, arbitrary: fc.constant(true) },
  ),
});

const stepArbitrary: fc.Arbitrary<Step> = fc.oneof(
  { weight: 3, arbitrary: editStepArbitrary },
  {
    weight: 2,
    arbitrary: fc.record({
      kind: fc.constant("deliver" as const),
      from: fc.nat({ max: REPLICA_IDS.length - 1 }),
      to: fc.nat({ max: REPLICA_IDS.length - 1 }),
      picks: fc.array(fc.nat()),
    }),
  },
  {
    weight: 1,
    arbitrary: fc.record({
      kind: fc.constant("anchor" as const),
      replica: fc.nat({ max: REPLICA_IDS.length - 1 }),
      block: fc.nat(),
      offset: fc.nat(),
      affinity: fc.constantFrom("before" as const, "after" as const),
    }),
  },
);

/** Apply one step and return the replica whose state it changed. */
const applyStep = (
  step: Step,
  replicas: ReadonlyArray<BlockReplica>,
  anchors: BlockAnchor[],
): BlockReplica => {
  const replica = replicas[step.kind === "deliver" ? step.to : step.replica]!;
  if (step.kind === "edit") {
    const before = replica.exportEvents();
    try {
      applyEdit(replica, step.operation, step.abort);
    } catch (error) {
      if (!(error instanceof AbortedEdit)) {
        throw error;
      }
      expect(replica.exportEvents()).toEqual(before);
    }
  } else if (step.kind === "deliver") {
    const batches = replicas[step.from]!.exportEvents();
    replica.applyRemoteEvents(
      step.picks.map((pick) => batches[pick % batches.length]!),
    );
  } else {
    const block = pickBlock(replica, step.block);
    const offset = pickBoundary(block.text, step.offset);
    const anchor = replica.captureBlockAnchor(block.id, offset, step.affinity);
    expect(anchor).toEqual(
      captureBlockAnchorFromRebuild(
        rebuild(replica),
        block.id,
        offset,
        step.affinity,
      ),
    );
    anchors.push(anchor);
  }
  return replica;
};

/** Thrown from inside a transaction after it has already edited. */
class AbortedEdit extends Error {}

const applyEdit = (
  replica: BlockReplica,
  operation: EditOperation,
  abort: boolean,
): void => {
  const document = replica.getDocument();
  const block = pickBlock(replica, "block" in operation ? operation.block : 0);
  replica.transact((transaction) => {
    applyOperation(transaction, operation, document, block);
    if (abort) {
      throw new AbortedEdit();
    }
  });
};

const applyOperation = (
  transaction: BlockTransaction,
  operation: EditOperation,
  document: BlockDocument,
  block: Block,
): void => {
  switch (operation.kind) {
    case "insertText":
      transaction.insertText(
        block.id,
        pickBoundary(block.text, operation.offset),
        operation.text,
      );
      return;
    case "deleteText": {
      const [from, to] = pickRange(
        block.text,
        operation.from,
        operation.length,
      );
      transaction.deleteText(block.id, from, to);
      return;
    }
    case "insertBlock": {
      const after = document.blocks[operation.after % document.blocks.length]!;
      transaction.insertBlock(after.id, {
        type: operation.type,
        text: operation.text,
        marks:
          operation.bold && operation.text.length > 0
            ? [
                {
                  kind: "bold",
                  from: 0,
                  to: operation.text.length,
                  value: true,
                },
              ]
            : [],
      });
      return;
    }
    case "splitBlock":
      transaction.splitBlock(
        block.id,
        pickBoundary(block.text, operation.offset),
        operation.retype ? { type: operation.type } : {},
      );
      return;
    case "joinBlock":
    case "deleteBlock": {
      const candidates = document.blocks.slice(1);
      if (candidates.length === 0) {
        return;
      }
      const target = candidates[operation.block % candidates.length]!;
      if (operation.kind === "joinBlock") {
        transaction.joinBlock(target.id);
      } else {
        transaction.deleteBlock(target.id);
      }
      return;
    }
    case "setBlock": {
      const parent =
        document.blocks[operation.parent % document.blocks.length]!;
      transaction.setBlock(block.id, {
        type: operation.type,
        checked: operation.checked,
        parentId: parent.id === block.id ? null : parent.id,
      });
      return;
    }
    case "setMark": {
      const [from, to] = pickRange(
        block.text,
        operation.from,
        operation.length,
      );
      transaction.setMark(
        block.id,
        from,
        to,
        operation.mark,
        operation.clear
          ? null
          : operation.mark === "link"
            ? { url: "https://softmaple.dev/docs" }
            : true,
      );
      return;
    }
    case "replaceDocument": {
      const dropped =
        document.blocks.length > 1
          ? document.blocks[
              1 + (operation.drop % (document.blocks.length - 1))
            ]!.id
          : null;
      transaction.replaceDocument({
        blocks: document.blocks.flatMap((current) => {
          if (current.id === dropped) {
            return [];
          }
          const kept = {
            id: current.id,
            type: current.type,
            text: current.id === block.id ? operation.text : current.text,
            attrs: current.attrs,
            marks: current.id === block.id ? [] : current.marks,
          };
          return current.id === block.id && operation.add
            ? [kept, { type: "paragraph" as const, text: operation.text }]
            : [kept];
        }),
      });
      return;
    }
  }
};

const deliverEverything = (replicas: ReadonlyArray<BlockReplica>): void => {
  const all = new Map<string, RichTextEventBatch>();
  for (const replica of replicas) {
    for (const batch of replica.exportEvents()) {
      all.set(batch.batchId, batch);
    }
  }
  for (const replica of replicas) {
    const result = replica.applyRemoteEvents([...all.values()].reverse());
    expect(result.pendingBatchIds).toEqual([]);
  }
};

const expectMatchesRebuild = (
  replica: BlockReplica,
  anchors: ReadonlyArray<BlockAnchor>,
): void => {
  const rebuilt = rebuild(replica);
  expect(replica.getDocument()).toEqual(rebuilt.state.document);
  expect(replica.applyRemoteEvents([]).pendingBatchIds).toEqual(
    replica
      .exportEvents()
      .map(({ batchId }) => batchId)
      .filter((batchId) => !rebuilt.integratedBatchIds.has(batchId)),
  );
  for (const anchor of anchors) {
    expect(outcome(() => replica.tryResolveBlockAnchor(anchor))).toEqual(
      outcome(() => tryResolveBlockAnchorFromRebuild(rebuilt, anchor)),
    );
  }
};

const rebuild = (replica: BlockReplica) =>
  rebuildFromBatches("oracle", replica.exportEvents());

const outcome = <T>(
  read: () => T,
): { readonly value: T } | { readonly error: string } => {
  try {
    return { value: read() };
  } catch (error) {
    return { error: String(error) };
  }
};

const pickBlock = (replica: BlockReplica, choice: number) => {
  const { blocks } = replica.getDocument();
  return blocks[choice % blocks.length]!;
};

/** UTF-16 offsets that do not split a code point. */
const boundaries = (text: string): number[] => {
  const offsets = [0];
  for (const point of text) {
    offsets.push(offsets.at(-1)! + point.length);
  }
  return offsets;
};

const pickBoundary = (text: string, choice: number): number => {
  const offsets = boundaries(text);
  return offsets[choice % offsets.length]!;
};

const pickRange = (
  text: string,
  start: number,
  length: number,
): readonly [number, number] => {
  const offsets = boundaries(text);
  const from = start % offsets.length;
  const to = Math.min(offsets.length - 1, from + (length % offsets.length));
  return [offsets[from]!, offsets[to]!];
};
