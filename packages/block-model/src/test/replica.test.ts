import { describe, expect, it, vi } from "vitest";
import { EgWalkerReplica } from "@softmaple/eg-walker";

import {
  BLOCK_MARKER,
  BOOTSTRAP_BATCH_ID,
  BOOTSTRAP_BLOCK_ID,
  BOOTSTRAP_EVENT_ID,
  BlockReplica,
  isRichTextEventBatch,
  parseRichTextEventBatch,
  type BlockDocumentInput,
  type RichTextEventBatch,
} from "../index";
import { materializeBlockState } from "../materialize";
import { toGraphEvent } from "../wire";

describe("BlockReplica", () => {
  it("should start from one fixed event-backed paragraph marker", () => {
    // Arrange / Act
    const replica = new BlockReplica("alice");
    const [bootstrap] = replica.exportEvents();

    // Assert
    expect(replica.getDocument()).toEqual({
      schemaVersion: 1,
      blocks: [
        {
          id: BOOTSTRAP_BLOCK_ID,
          type: "paragraph",
          text: "",
          attrs: {
            parentId: null,
            language: null,
            theme: null,
            start: null,
            value: null,
            checked: null,
          },
          marks: [],
        },
      ],
    });
    expect(bootstrap).toMatchObject({
      batchId: BOOTSTRAP_BATCH_ID,
      parentVersion: [],
      events: [
        {
          id: BOOTSTRAP_EVENT_ID,
          parentVersion: [],
          timestamp: 0,
          operation: { type: "insert", index: 0, text: BLOCK_MARKER },
        },
      ],
    });
  });

  it("should project text, line breaks, tabs, code fields, and nested lists", () => {
    // Arrange
    const replica = new BlockReplica("alice");

    // Act
    replica.transact((transaction) => {
      transaction.insertText(BOOTSTRAP_BLOCK_ID, 0, "line\n\tend");
      transaction.setBlock(BOOTSTRAP_BLOCK_ID, {
        type: "code",
        language: "typescript",
        theme: "github-dark",
      });
      const parent = transaction.insertBlock(BOOTSTRAP_BLOCK_ID, {
        id: "list-parent",
        type: "number-list",
        text: "one",
        attrs: { start: 3, value: 3 },
      });
      transaction.insertBlock(parent, {
        id: "list-child",
        type: "check-list",
        text: "done",
        attrs: { parentId: parent, checked: true },
      });
    });

    // Assert
    expect(replica.getDocument().blocks).toMatchObject([
      {
        id: BOOTSTRAP_BLOCK_ID,
        type: "code",
        text: "line\n\tend",
        attrs: { language: "typescript", theme: "github-dark" },
      },
      {
        id: "list-parent",
        type: "number-list",
        attrs: { start: 3, value: 3, parentId: null },
      },
      {
        id: "list-child",
        type: "check-list",
        attrs: { checked: true, parentId: "list-parent" },
      },
    ]);
  });

  it("should preserve independent marks and exclude concurrent link boundaries", () => {
    // Arrange
    const source = new BlockReplica("source");
    source.transact((transaction) => {
      transaction.insertText(BOOTSTRAP_BLOCK_ID, 0, "AB");
      transaction.setMark(BOOTSTRAP_BLOCK_ID, 1, 2, "bold", true);
      transaction.setMark(BOOTSTRAP_BLOCK_ID, 1, 2, "italic", true);
      transaction.setMark(BOOTSTRAP_BLOCK_ID, 1, 2, "link", {
        url: "https://softmaple.dev",
        target: "_blank",
        rel: "noreferrer",
        title: "SoftMaple",
      });
    });
    const branch = BlockReplica.deserialize(source.serialize(), "branch");

    // Act
    branch.transact((transaction) => {
      transaction.insertText(BOOTSTRAP_BLOCK_ID, 1, "x");
    });

    // Assert
    expect(branch.getDocument().blocks[0]).toMatchObject({
      text: "AxB",
      marks: [
        { kind: "bold", from: 1, to: 3, value: true },
        { kind: "italic", from: 1, to: 3, value: true },
        {
          kind: "link",
          from: 2,
          to: 3,
          value: {
            url: "https://softmaple.dev",
            target: "_blank",
            rel: "noreferrer",
            title: "SoftMaple",
          },
        },
      ],
    });
  });

  it("should keep a last-block mark out of a later block", () => {
    // Arrange
    const replica = new BlockReplica("alice");
    replica.transact((transaction) => {
      transaction.insertText(BOOTSTRAP_BLOCK_ID, 0, "A");
      transaction.setMark(BOOTSTRAP_BLOCK_ID, 0, 1, "bold", true);
    });

    // Act
    replica.transact((transaction) => {
      transaction.insertBlock(BOOTSTRAP_BLOCK_ID, {
        id: "plain-block",
        type: "paragraph",
        text: "B",
        marks: [],
      });
    });

    // Assert
    expect(replica.getDocument().blocks).toMatchObject([
      { id: BOOTSTRAP_BLOCK_ID, marks: [{ kind: "bold", from: 0, to: 1 }] },
      { id: "plain-block", text: "B", marks: [] },
    ]);
  });

  it("should keep a block-end mark out of a block inserted before its successor", () => {
    // Arrange
    const replica = new BlockReplica("alice");
    replica.transact((transaction) => {
      transaction.insertText(BOOTSTRAP_BLOCK_ID, 0, "A");
      transaction.insertBlock(BOOTSTRAP_BLOCK_ID, {
        id: "successor",
        type: "paragraph",
        text: "C",
      });
    });
    replica.transact((transaction) => {
      transaction.setMark(BOOTSTRAP_BLOCK_ID, 0, 1, "bold", true);
    });

    // Act
    replica.transact((transaction) => {
      transaction.insertBlock(BOOTSTRAP_BLOCK_ID, {
        id: "inserted",
        type: "paragraph",
        text: "B",
        marks: [],
      });
    });

    // Assert
    expect(replica.getDocument().blocks).toMatchObject([
      { id: BOOTSTRAP_BLOCK_ID, marks: [{ kind: "bold", from: 0, to: 1 }] },
      { id: "inserted", text: "B", marks: [] },
      { id: "successor", text: "C", marks: [] },
    ]);
  });

  it("should let a block-end mark follow a split child", () => {
    // Arrange
    const replica = new BlockReplica("alice");
    replica.transact((transaction) => {
      transaction.insertText(BOOTSTRAP_BLOCK_ID, 0, "A");
      transaction.setMark(BOOTSTRAP_BLOCK_ID, 0, 1, "bold", true);
    });

    // Act
    let childId = "";
    replica.transact((transaction) => {
      childId = transaction.splitBlock(BOOTSTRAP_BLOCK_ID, 1);
      transaction.insertText(childId, 0, "B");
    });

    // Assert
    expect(replica.getDocument().blocks).toMatchObject([
      { id: BOOTSTRAP_BLOCK_ID, text: "A", marks: [{ kind: "bold" }] },
      { id: childId, text: "B", marks: [{ kind: "bold", from: 0, to: 1 }] },
    ]);
  });

  it("should inherit concurrent same-block appends in every event and delivery order", () => {
    for (const [caseIndex, [markReplicaId, textReplicaId]] of (
      [
        ["a-mark", "z-text"],
        ["z-mark", "a-text"],
      ] as const
    ).entries()) {
      // Arrange
      const base = new BlockReplica(`append-base-${caseIndex}`);
      base.transact((transaction) => {
        transaction.insertText(BOOTSTRAP_BLOCK_ID, 0, "A");
      });
      const marked = BlockReplica.deserialize(base.serialize(), markReplicaId);
      const appended = BlockReplica.deserialize(
        base.serialize(),
        textReplicaId,
      );
      const markBatch = marked.transact((transaction) => {
        transaction.setMark(BOOTSTRAP_BLOCK_ID, 0, 1, "bold", true);
      })!;
      const appendBatch = appended.transact((transaction) => {
        transaction.insertText(BOOTSTRAP_BLOCK_ID, 1, "X");
      })!;

      for (const [deliveryIndex, batches] of [
        [markBatch, appendBatch],
        [appendBatch, markBatch],
      ].entries()) {
        const receiver = BlockReplica.deserialize(
          base.serialize(),
          `append-receiver-${caseIndex}-${deliveryIndex}`,
        );

        // Act
        receiver.applyRemoteEvents(batches);

        // Assert
        expect(receiver.getDocument().blocks[0]).toMatchObject({
          text: "AX",
          marks: [{ kind: "bold", from: 0, to: 2, value: true }],
        });
      }
    }
  });

  it("should exclude concurrent independent blocks in every event and delivery order", () => {
    for (const [caseIndex, [markReplicaId, blockReplicaId]] of (
      [
        ["a-mark", "z-block"],
        ["z-mark", "a-block"],
      ] as const
    ).entries()) {
      // Arrange
      const base = new BlockReplica(`block-base-${caseIndex}`);
      base.transact((transaction) => {
        transaction.insertText(BOOTSTRAP_BLOCK_ID, 0, "A");
      });
      const marked = BlockReplica.deserialize(base.serialize(), markReplicaId);
      const inserted = BlockReplica.deserialize(
        base.serialize(),
        blockReplicaId,
      );
      const markBatch = marked.transact((transaction) => {
        transaction.setMark(BOOTSTRAP_BLOCK_ID, 0, 1, "bold", true);
      })!;
      const blockBatch = inserted.transact((transaction) => {
        transaction.insertBlock(BOOTSTRAP_BLOCK_ID, {
          id: `independent-${caseIndex}`,
          type: "paragraph",
          text: "B",
          marks: [],
        });
      })!;

      for (const [deliveryIndex, batches] of [
        [markBatch, blockBatch],
        [blockBatch, markBatch],
      ].entries()) {
        const receiver = BlockReplica.deserialize(
          base.serialize(),
          `block-receiver-${caseIndex}-${deliveryIndex}`,
        );

        // Act
        receiver.applyRemoteEvents(batches);

        // Assert
        expect(receiver.getDocument().blocks).toMatchObject([
          {
            id: BOOTSTRAP_BLOCK_ID,
            text: "A",
            marks: [{ kind: "bold", from: 0, to: 1, value: true }],
          },
          {
            id: `independent-${caseIndex}`,
            text: "B",
            marks: [],
          },
        ]);
      }
    }
  });

  it("should preserve a joined block's originating marks", () => {
    // Arrange
    const replica = new BlockReplica("alice");
    replica.transact((transaction) => {
      transaction.insertText(BOOTSTRAP_BLOCK_ID, 0, "A");
      transaction.insertBlock(BOOTSTRAP_BLOCK_ID, {
        id: "joined-marked",
        type: "paragraph",
        text: "B",
      });
      transaction.setMark("joined-marked", 0, 1, "bold", true);
    });

    // Act
    replica.transact((transaction) => transaction.joinBlock("joined-marked"));

    // Assert
    expect(replica.getDocument().blocks).toMatchObject([
      {
        id: BOOTSTRAP_BLOCK_ID,
        text: "AB",
        marks: [{ kind: "bold", from: 1, to: 2, value: true }],
      },
    ]);
  });

  it("should apply a new mark across text that was already joined", () => {
    // Arrange
    const replica = new BlockReplica("alice");
    replica.transact((transaction) => {
      transaction.insertText(BOOTSTRAP_BLOCK_ID, 0, "A");
      transaction.insertBlock(BOOTSTRAP_BLOCK_ID, {
        id: "joined-before-mark",
        type: "paragraph",
        text: "B",
      });
      transaction.joinBlock("joined-before-mark");
    });

    // Act
    replica.transact((transaction) => {
      transaction.setMark(BOOTSTRAP_BLOCK_ID, 0, 2, "bold", true);
    });

    // Assert
    expect(replica.getDocument().blocks).toMatchObject([
      {
        id: BOOTSTRAP_BLOCK_ID,
        text: "AB",
        marks: [{ kind: "bold", from: 0, to: 2, value: true }],
      },
    ]);
  });

  it("should keep joined mark ownership when its visible owner is later joined", () => {
    // Arrange
    const replica = new BlockReplica("alice");
    replica.transact((transaction) => {
      transaction.insertText(BOOTSTRAP_BLOCK_ID, 0, "P");
      transaction.insertBlock(BOOTSTRAP_BLOCK_ID, {
        id: "marked-owner",
        type: "paragraph",
        text: "A",
      });
      transaction.insertBlock("marked-owner", {
        id: "marked-origin",
        type: "paragraph",
        text: "B",
      });
      transaction.joinBlock("marked-origin");
      transaction.setMark("marked-owner", 0, 2, "bold", true);
    });

    // Act
    replica.transact((transaction) => transaction.joinBlock("marked-owner"));

    // Assert
    expect(replica.getDocument().blocks).toMatchObject([
      {
        id: BOOTSTRAP_BLOCK_ID,
        text: "PAB",
        marks: [{ kind: "bold", from: 1, to: 3, value: true }],
      },
    ]);
  });

  it("should exclude an independent block joined concurrently with a mark", () => {
    for (const [caseIndex, [markReplicaId, joinReplicaId]] of (
      [
        ["a-mark", "z-join"],
        ["z-mark", "a-join"],
      ] as const
    ).entries()) {
      // Arrange
      const base = new BlockReplica(`joined-base-${caseIndex}`);
      base.transact((transaction) => {
        transaction.insertText(BOOTSTRAP_BLOCK_ID, 0, "A");
      });
      const marked = BlockReplica.deserialize(base.serialize(), markReplicaId);
      const joined = BlockReplica.deserialize(base.serialize(), joinReplicaId);
      const markBatch = marked.transact((transaction) => {
        transaction.setMark(BOOTSTRAP_BLOCK_ID, 0, 1, "bold", true);
      })!;
      const joinBatch = joined.transact((transaction) => {
        transaction.insertBlock(BOOTSTRAP_BLOCK_ID, {
          id: `concurrent-joined-${caseIndex}`,
          type: "paragraph",
          text: "B",
        });
        transaction.joinBlock(`concurrent-joined-${caseIndex}`);
      })!;

      for (const [deliveryIndex, batches] of [
        [markBatch, joinBatch],
        [joinBatch, markBatch],
      ].entries()) {
        const receiver = BlockReplica.deserialize(
          base.serialize(),
          `joined-receiver-${caseIndex}-${deliveryIndex}`,
        );

        // Act
        receiver.applyRemoteEvents(batches);

        // Assert
        expect(receiver.getDocument().blocks).toMatchObject([
          {
            id: BOOTSTRAP_BLOCK_ID,
            text: "AB",
            marks: [{ kind: "bold", from: 0, to: 1, value: true }],
          },
        ]);
      }
    }
  });

  it("should compose and independently clear every non-link mark", () => {
    // Arrange
    const replica = new BlockReplica("alice");

    // Act
    replica.transact((transaction) => {
      transaction.insertText(BOOTSTRAP_BLOCK_ID, 0, "abcd");
      transaction.setMark(BOOTSTRAP_BLOCK_ID, 0, 4, "bold", true);
      transaction.setMark(BOOTSTRAP_BLOCK_ID, 0, 2, "italic", true);
      transaction.setMark(BOOTSTRAP_BLOCK_ID, 1, 3, "underline", true);
      transaction.setMark(BOOTSTRAP_BLOCK_ID, 2, 4, "strike", true);
      transaction.setMark(BOOTSTRAP_BLOCK_ID, 3, 4, "inline-code", true);
      transaction.setMark(BOOTSTRAP_BLOCK_ID, 2, 3, "underline", null);
    });

    // Assert
    expect(replica.getDocument().blocks[0]?.marks).toEqual(
      expect.arrayContaining([
        { kind: "bold", from: 0, to: 4, value: true },
        { kind: "italic", from: 0, to: 2, value: true },
        { kind: "underline", from: 1, to: 2, value: true },
        { kind: "strike", from: 2, to: 4, value: true },
        { kind: "inline-code", from: 3, to: 4, value: true },
      ]),
    );
  });

  it("should split and join without deleting the stable marker", () => {
    // Arrange
    const replica = new BlockReplica("alice");
    let splitId = "";

    // Act
    replica.transact((transaction) => {
      transaction.insertText(BOOTSTRAP_BLOCK_ID, 0, "hello");
      splitId = transaction.splitBlock(BOOTSTRAP_BLOCK_ID, 2);
    });
    expect(replica.getDocument().blocks.map(({ text }) => text)).toEqual([
      "he",
      "llo",
    ]);
    replica.transact((transaction) => transaction.joinBlock(splitId));

    // Assert
    expect(replica.getDocument().blocks).toMatchObject([
      { id: BOOTSTRAP_BLOCK_ID, text: "hello" },
    ]);
    const splitEvent = replica
      .exportEvents()
      .flatMap(({ events }) => events)
      .find(({ effect }) =>
        effect.type === "block-create" ? effect.blockId === splitId : false,
      );
    expect(splitEvent?.operation).toMatchObject({
      type: "insert",
      text: BLOCK_MARKER,
    });
  });

  it("should make a concurrent source remove win over split descendants", () => {
    // Arrange
    const base = createReplicaWithRemovableBlock();
    const left = BlockReplica.deserialize(base.serialize(), "left");
    const right = BlockReplica.deserialize(base.serialize(), "right");
    const split = left.transact((transaction) => {
      transaction.splitBlock("source-block", 1, {}, "split-child");
    })!;
    const remove = right.transact((transaction) => {
      transaction.deleteBlock("source-block");
    })!;

    // Act
    left.applyRemoteEvents(remove);
    right.applyRemoteEvents(split);

    // Assert
    expect(left.getDocument()).toEqual(right.getDocument());
    expect(left.getDocument().blocks.map(({ id }) => id)).toEqual([
      BOOTSTRAP_BLOCK_ID,
    ]);
  });

  it("should retain a child when a source remove causally observes its split", () => {
    // Arrange
    const replica = createReplicaWithRemovableBlock();
    replica.transact((transaction) => {
      transaction.splitBlock("source-block", 1, {}, "split-child");
    });

    // Act
    replica.transact((transaction) => {
      transaction.deleteBlock("source-block");
    });

    // Assert
    expect(replica.getDocument().blocks).toMatchObject([
      { id: BOOTSTRAP_BLOCK_ID },
      { id: "split-child", text: "B" },
    ]);
  });

  it("should use causal LWW before concurrent event-ID tie-breaking", () => {
    // Arrange
    const base = new BlockReplica("seed");
    const low = BlockReplica.deserialize(base.serialize(), "a");
    const high = BlockReplica.deserialize(base.serialize(), "z");
    const lowBatch = low.transact((transaction) => {
      transaction.setBlock(BOOTSTRAP_BLOCK_ID, { type: "h1" });
    })!;
    const highBatch = high.transact((transaction) => {
      transaction.setBlock(BOOTSTRAP_BLOCK_ID, { type: "h2" });
    })!;
    low.applyRemoteEvents(highBatch);
    high.applyRemoteEvents(lowBatch);

    // Act / Assert: concurrent maximum ID wins
    expect(low.getDocument().blocks[0]?.type).toBe("h2");
    expect(high.getDocument()).toEqual(low.getDocument());

    // Act: a causally later low-ID event must beat the earlier high-ID event
    low.transact((transaction) => {
      transaction.setBlock(BOOTSTRAP_BLOCK_ID, { type: "h3" });
    });

    // Assert
    expect(low.getDocument().blocks[0]?.type).toBe("h3");
  });

  it("should atomically notify once for local and newly integrated remote batches", () => {
    // Arrange
    const source = new BlockReplica("source");
    const receiver = new BlockReplica("receiver");
    const localListener = vi.fn();
    const remoteListener = vi.fn();
    source.subscribe(localListener);
    receiver.subscribe(remoteListener);

    // Act
    const batch = source.transact((transaction) => {
      transaction.insertText(BOOTSTRAP_BLOCK_ID, 0, "hello");
      transaction.setMark(BOOTSTRAP_BLOCK_ID, 0, 5, "bold", true);
      transaction.setBlock(BOOTSTRAP_BLOCK_ID, { type: "quote" });
    })!;
    receiver.applyRemoteEvents(batch);
    receiver.applyRemoteEvents(batch);

    // Assert
    expect(localListener).toHaveBeenCalledTimes(1);
    expect(localListener.mock.calls[0]?.[0]).toMatchObject({ origin: "local" });
    expect(remoteListener).toHaveBeenCalledTimes(1);
    expect(remoteListener.mock.calls[0]?.[0]).toMatchObject({
      origin: "remote",
      batchIds: [batch.batchId],
    });
    expect(receiver.getDocument()).toEqual(source.getDocument());
  });

  it("should replace a document with transaction-local nested parent IDs", () => {
    // Arrange
    const replica = new BlockReplica("alice");
    const input: BlockDocumentInput = {
      blocks: [
        { inputId: "intro", type: "h1", text: "Title" },
        {
          inputId: "parent",
          type: "bullet-list",
          text: "Parent",
        },
        {
          inputId: "child",
          parentInputId: "parent",
          type: "check-list",
          text: "Child",
          attrs: { checked: false },
        },
      ],
    };
    let stableIds: ReadonlyArray<string> = [];

    // Act
    const batch = replica.transact((transaction) => {
      stableIds = transaction.replaceDocument(input);
    });
    const unchanged = replica.transact((transaction) => {
      transaction.replaceDocument({
        blocks: replica.getDocument().blocks.map((block) => ({
          id: block.id,
          type: block.type,
          text: block.text,
          attrs: block.attrs,
          marks: block.marks,
        })),
      });
    });

    // Assert
    expect(batch).not.toBeNull();
    expect(stableIds).toHaveLength(3);
    expect(replica.getDocument().blocks[2]?.attrs.parentId).toBe(stableIds[1]);
    expect(unchanged).toBeNull();
  });

  it("should reject remapping a non-bootstrap stable ID into first position", () => {
    // Arrange
    const replica = new BlockReplica("alice");
    replica.transact((transaction) => {
      transaction.insertBlock(BOOTSTRAP_BLOCK_ID, {
        id: "second",
        type: "paragraph",
        text: "Second",
      });
    });

    // Act / Assert
    expect(() =>
      replica.transact((transaction) => {
        transaction.replaceDocument({
          blocks: [{ id: "second", type: "h1", text: "Second" }],
        });
      }),
    ).toThrow("cannot replace first block ID");
    expect(replica.getDocument().blocks.map(({ id }) => id)).toEqual([
      BOOTSTRAP_BLOCK_ID,
      "second",
    ]);
  });

  it("should emit a minimal text splice when replaceDocument appends text", () => {
    // Arrange
    const base = new BlockReplica("seed");
    base.transact((transaction) => {
      transaction.insertText(BOOTSTRAP_BLOCK_ID, 0, "A");
    });
    const left = BlockReplica.deserialize(base.serialize(), "left");
    const right = BlockReplica.deserialize(base.serialize(), "right");

    // Act
    const leftBatch = left.transact((transaction) => {
      transaction.replaceDocument({
        blocks: [
          {
            id: BOOTSTRAP_BLOCK_ID,
            type: "paragraph",
            text: "Ax",
          },
        ],
      });
    })!;
    const rightBatch = right.transact((transaction) => {
      transaction.replaceDocument({
        blocks: [
          {
            id: BOOTSTRAP_BLOCK_ID,
            type: "paragraph",
            text: "Ay",
          },
        ],
      });
    })!;
    left.applyRemoteEvents(rightBatch);
    right.applyRemoteEvents(leftBatch);

    // Assert
    expect(leftBatch.events).toHaveLength(1);
    expect(leftBatch.events[0]).toMatchObject({
      operation: { type: "insert", text: "x" },
      effect: { type: "text-insert", text: "x" },
    });
    expect(left.getDocument()).toEqual(right.getDocument());
    expect(left.getDocument().blocks[0]?.text).toMatch(/^A(?:xy|yx)$/);
  });

  it("should preserve directional block anchors across a split", () => {
    // Arrange
    const replica = new BlockReplica("alice");
    replica.transact((transaction) => {
      transaction.insertText(BOOTSTRAP_BLOCK_ID, 0, "AB");
    });
    const left = replica.captureBlockAnchor(BOOTSTRAP_BLOCK_ID, 1, "after");
    const right = replica.captureBlockAnchor(BOOTSTRAP_BLOCK_ID, 1, "before");
    let childId = "";

    // Act
    replica.transact((transaction) => {
      childId = transaction.splitBlock(BOOTSTRAP_BLOCK_ID, 1);
    });

    // Assert
    expect(replica.resolveBlockAnchor(left)).toEqual({
      blockId: BOOTSTRAP_BLOCK_ID,
      offset: 1,
    });
    expect(replica.resolveBlockAnchor(right)).toEqual({
      blockId: childId,
      offset: 0,
    });
  });

  it("should preserve the start boundary of a joined block", () => {
    // Arrange
    const replica = new BlockReplica("alice");
    replica.transact((transaction) => {
      transaction.insertText(BOOTSTRAP_BLOCK_ID, 0, "A");
      transaction.insertBlock(BOOTSTRAP_BLOCK_ID, {
        id: "joined",
        type: "paragraph",
        text: "B",
      });
    });
    const anchor = replica.captureBlockAnchor("joined", 0, "before");

    // Act
    replica.transact((transaction) => transaction.joinBlock("joined"));

    // Assert
    expect(replica.getDocument().blocks[0]?.text).toBe("AB");
    expect(replica.resolveBlockAnchor(anchor)).toEqual({
      blockId: BOOTSTRAP_BLOCK_ID,
      offset: 1,
    });
  });

  it("should round-trip JSON-safe storage and reject corrupt wire batches", () => {
    // Arrange
    const source = new BlockReplica("source");
    const batch = source.transact((transaction) => {
      transaction.insertText(BOOTSTRAP_BLOCK_ID, 0, `reserved:${BLOCK_MARKER}`);
    })!;
    const wire = JSON.parse(JSON.stringify(source.serialize())) as unknown;
    const corrupt = {
      ...batch,
      parentVersion: new Set(batch.parentVersion),
    };

    // Act
    const restored = BlockReplica.deserialize(wire, "restored");

    // Assert
    expect(restored.getDocument()).toEqual(source.getDocument());
    expect(
      batch.events.every(({ parentVersion }) => Array.isArray(parentVersion)),
    ).toBe(true);
    expect(isRichTextEventBatch(batch)).toBe(true);
    expect(isRichTextEventBatch(corrupt)).toBe(false);
    expect(() => parseRichTextEventBatch(corrupt)).toThrow("must be an array");
  });

  it("should detach and freeze mark anchors parsed from the wire", () => {
    // Arrange
    const source = new BlockReplica("source");
    const batch = source.transact((transaction) => {
      transaction.insertText(BOOTSTRAP_BLOCK_ID, 0, "AB");
      transaction.setMark(BOOTSTRAP_BLOCK_ID, 0, 1, "bold", true);
    })!;
    const wire = JSON.parse(JSON.stringify(batch)) as RichTextEventBatch;
    const wireMark = wire.events.find(
      ({ effect }) => effect.type === "mark-set",
    );
    if (
      wireMark?.effect.type !== "mark-set" ||
      wireMark.effect.range.start.type !== "atom"
    ) {
      throw new Error("Expected an atom-backed mark range");
    }
    const parsed = parseRichTextEventBatch(wire);
    const parsedMark = parsed.events.find(
      ({ effect }) => effect.type === "mark-set",
    );
    if (parsedMark?.effect.type !== "mark-set") {
      throw new Error("Expected a parsed mark range");
    }
    const receiver = new BlockReplica("receiver");
    receiver.applyRemoteEvents(wire);
    const documentBeforeMutation = receiver.getDocument();

    // Act
    const mutableStart = wireMark.effect.range.start as { offset: number };
    mutableStart.offset = 999;

    // Assert
    expect(Object.isFrozen(parsedMark.effect.range.start)).toBe(true);
    expect(receiver.getDocument()).toEqual(documentBeforeMutation);
    expect(() =>
      receiver.transact((transaction) => {
        transaction.insertText(BOOTSTRAP_BLOCK_ID, 2, "x");
      }),
    ).not.toThrow();
  });

  it("should replay the sequence once when materializing many anchors", () => {
    // Arrange
    const source = new BlockReplica("source");
    source.transact((transaction) => {
      transaction.insertText(BOOTSTRAP_BLOCK_ID, 0, "A");
      transaction.setMark(BOOTSTRAP_BLOCK_ID, 0, 1, "bold", true);
      transaction.insertBlock(BOOTSTRAP_BLOCK_ID, {
        id: "second",
        type: "paragraph",
        text: "B",
      });
      transaction.setMark("second", 0, 1, "italic", true);
    });
    const batches = source.exportEvents();
    const bootstrap = batches.find(
      ({ batchId }) => batchId === BOOTSTRAP_BATCH_ID,
    )!;
    const local = batches.find(
      ({ batchId }) => batchId !== BOOTSTRAP_BATCH_ID,
    )!;
    const events = [...bootstrap.events, ...local.events];
    const egWalker = new EgWalkerReplica("projection");
    egWalker.applyRemoteEvents(events.map(toGraphEvent));
    const exportSpy = vi.spyOn(egWalker, "exportEventGraph");

    // Act / Assert
    try {
      const state = materializeBlockState(egWalker, events);
      expect(state.document.blocks).toHaveLength(2);
      expect(exportSpy).toHaveBeenCalledTimes(1);
    } finally {
      exportSpy.mockRestore();
    }
  });
});

// Helpers

const createReplicaWithRemovableBlock = (): BlockReplica => {
  const replica = new BlockReplica("seed");
  replica.transact((transaction) => {
    transaction.insertBlock(BOOTSTRAP_BLOCK_ID, {
      id: "source-block",
      type: "paragraph",
      text: "AB",
    });
  });
  return replica;
};
