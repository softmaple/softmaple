import { CodeNode } from "@lexical/code";
import { $createLinkNode, LinkNode } from "@lexical/link";
import {
  $createListItemNode,
  $isListItemNode,
  $isListNode,
  ListItemNode,
  ListNode,
} from "@lexical/list";
import { $createHeadingNode, HeadingNode, QuoteNode } from "@lexical/rich-text";
import {
  $createParagraphNode,
  $createRangeSelection,
  $createTextNode,
  $getNodeByKey,
  $getRoot,
  $isElementNode,
  $isTextNode,
  $setSelection,
  COLLABORATION_TAG,
  createEditor,
  type LexicalEditor,
} from "lexical";
import {
  BOOTSTRAP_BLOCK_ID,
  createBlockReplica,
  type BlockReplicaOrigin,
  type RichTextEventBatch,
} from "@softmaple/block-model";
import { describe, expect, it, vi } from "vitest";
import { createLexicalBinding } from "./binding";
import { projectLexicalDocument } from "./lexical-to-projection";

const createTestEditor = (): LexicalEditor =>
  createEditor({
    namespace: `binding-${Math.random()}`,
    nodes: [HeadingNode, QuoteNode, CodeNode, LinkNode, ListNode, ListItemNode],
    onError: (error) => {
      throw error;
    },
  });

const getProjectedText = (editor: LexicalEditor): string =>
  editor.getEditorState().read(() =>
    projectLexicalDocument()
      .blocks.map(({ text }) => text)
      .join("|"),
  );

const replaceFirstBlock = (editor: LexicalEditor, text: string): void => {
  editor.update(
    () => {
      const first = $getRoot().getFirstChild();
      if (!$isElementNode(first)) {
        throw new Error("Expected an element block");
      }
      first.clear().append($createTextNode(text));
    },
    { discrete: true },
  );
};

describe("createLexicalBinding", () => {
  it("reports an initial materialization failure and still creates a binding", () => {
    const replica = createBlockReplica("initial-materialize-error");
    const editor = createTestEditor();
    const error = new Error("initial materialization failed");
    vi.spyOn(editor, "update").mockImplementationOnce(() => {
      throw error;
    });
    const onError = vi.fn();

    const binding = createLexicalBinding({ editor, replica, onError });

    expect(onError).toHaveBeenCalledWith(error);
    expect(binding.replica).toBe(replica);
    binding.destroy();
  });

  it("broadcasts one local batch per update and applies a remote update without echo", () => {
    const firstReplica = createBlockReplica("first");
    const secondReplica = createBlockReplica("second");
    const firstEditor = createTestEditor();
    const secondEditor = createTestEditor();
    const firstBinding = createLexicalBinding({
      editor: firstEditor,
      replica: firstReplica,
    });
    const secondEditorUpdates: ReadonlySet<string>[] = [];
    const unregisterSecondEditor = secondEditor.registerUpdateListener(
      ({ tags }) => {
        secondEditorUpdates.push(new Set(tags));
      },
    );
    const secondBinding = createLexicalBinding({
      editor: secondEditor,
      replica: secondReplica,
    });
    secondEditorUpdates.length = 0;
    const localBatches: RichTextEventBatch[] = [];
    const secondOrigins: BlockReplicaOrigin[] = [];
    firstReplica.subscribe((change) => {
      if (change.origin === "local") {
        const byId = new Map(
          firstReplica.exportEvents().map((batch) => [batch.batchId, batch]),
        );
        for (const batchId of change.batchIds) {
          const batch = byId.get(batchId);
          if (batch !== undefined) localBatches.push(batch);
        }
      }
    });
    secondReplica.subscribe((change) => secondOrigins.push(change.origin));

    replaceFirstBlock(firstEditor, "Hello 😀");

    expect(localBatches).toHaveLength(1);
    secondBinding.applyRemoteEvents(localBatches);
    expect(secondReplica.getDocument()).toEqual(firstReplica.getDocument());
    expect(getProjectedText(secondEditor)).toBe("Hello 😀");
    expect(secondOrigins).toEqual(["remote"]);
    expect(secondEditorUpdates).toHaveLength(1);
    expect(secondEditorUpdates[0]?.has(COLLABORATION_TAG)).toBe(true);

    unregisterSecondEditor();
    firstBinding.destroy();
    secondBinding.destroy();
  });

  it("buffers remote batches during IME and commits composition first", async () => {
    const localReplica = createBlockReplica("ime-local");
    const remoteReplica = createBlockReplica("ime-remote");
    const editor = createTestEditor();
    const root = document.createElement("div");
    root.contentEditable = "true";
    document.body.append(root);
    editor.setRootElement(root);
    const binding = createLexicalBinding({ editor, replica: localReplica });
    const origins: BlockReplicaOrigin[] = [];
    localReplica.subscribe((change) => origins.push(change.origin));
    const firstRemoteBatch = remoteReplica.transact((transaction) => {
      transaction.insertText(BOOTSTRAP_BLOCK_ID, 0, "remote-one");
    });
    const secondRemoteBatch = remoteReplica.transact((transaction) => {
      transaction.insertText(
        BOOTSTRAP_BLOCK_ID,
        remoteReplica.getDocument().blocks[0]?.text.length ?? 0,
        "remote-two",
      );
    });
    if (firstRemoteBatch === null || secondRemoteBatch === null) {
      throw new Error("Expected two remote batches");
    }

    root.dispatchEvent(new CompositionEvent("compositionstart"));
    replaceFirstBlock(editor, "本地");
    expect(binding.applyRemoteEvents(firstRemoteBatch)).toBeNull();
    expect(binding.applyRemoteEvents(secondRemoteBatch)).toBeNull();
    expect(localReplica.getDocument().blocks[0]?.text).toBe("");

    root.dispatchEvent(new CompositionEvent("compositionend"));
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    await new Promise<void>((resolve) => queueMicrotask(resolve));

    expect(origins).toEqual(["local", "remote"]);
    const text = localReplica.getDocument().blocks[0]?.text ?? "";
    expect(text).toContain("本地");
    expect(text).toContain("remote-one");
    expect(text).toContain("remote-two");
    expect(getProjectedText(editor)).toBe(text);

    binding.destroy();
    editor.setRootElement(null);
    root.remove();
  });

  it("defers selection publication until composed text is committed", async () => {
    const replica = createBlockReplica("ime-selection");
    const editor = createTestEditor();
    const root = document.createElement("div");
    root.contentEditable = "true";
    document.body.append(root);
    editor.setRootElement(root);
    const onError = vi.fn();
    const onSelectionChange = vi.fn();
    const binding = createLexicalBinding({
      editor,
      replica,
      onError,
      onSelectionChange,
    });

    root.dispatchEvent(new CompositionEvent("compositionstart"));
    expect(() => {
      editor.update(
        () => {
          const block = $getRoot().getFirstChild();
          if (!$isElementNode(block)) throw new Error("Expected a block");
          const text = $createTextNode("本地");
          block.clear().append(text);
          text.selectEnd();
        },
        { discrete: true },
      );
    }).not.toThrow();

    expect(onError).not.toHaveBeenCalled();
    expect(onSelectionChange).not.toHaveBeenCalled();

    root.dispatchEvent(new CompositionEvent("compositionend"));
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    await new Promise<void>((resolve) => queueMicrotask(resolve));

    expect(replica.getDocument().blocks[0]?.text).toBe("本地");
    expect(onSelectionChange).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();

    binding.destroy();
    editor.setRootElement(null);
    root.remove();
  });

  it("flushes composition state when the editor root is removed", () => {
    const replica = createBlockReplica("ime-root-replacement");
    const editor = createTestEditor();
    const firstRoot = document.createElement("div");
    firstRoot.contentEditable = "true";
    document.body.append(firstRoot);
    editor.setRootElement(firstRoot);
    const binding = createLexicalBinding({ editor, replica });

    firstRoot.dispatchEvent(new CompositionEvent("compositionstart"));
    editor.setRootElement(null);
    editor.update(
      () => {
        const block = $getRoot().getFirstChild();
        if (!$isElementNode(block)) throw new Error("Expected a block");
        block.clear().append($createTextNode("committed"));
      },
      { discrete: true },
    );

    expect(replica.getDocument().blocks[0]?.text).toBe("committed");

    binding.destroy();
    firstRoot.remove();
  });

  it("materializes direct remote changes after composition ends", async () => {
    const replica = createBlockReplica("ime-direct-local");
    const remote = createBlockReplica("ime-direct-remote");
    const editor = createTestEditor();
    const root = document.createElement("div");
    root.contentEditable = "true";
    document.body.append(root);
    editor.setRootElement(root);
    const binding = createLexicalBinding({ editor, replica });
    const batch = remote.transact((transaction) => {
      transaction.insertText(BOOTSTRAP_BLOCK_ID, 0, "remote");
    });
    if (batch === null) throw new Error("Expected a remote batch");

    root.dispatchEvent(new CompositionEvent("compositionstart"));
    replica.applyRemoteEvents(batch);
    expect(getProjectedText(editor)).toBe("");

    root.dispatchEvent(new CompositionEvent("compositionend"));
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    await new Promise<void>((resolve) => queueMicrotask(resolve));

    expect(getProjectedText(editor)).toBe("remote");
    binding.destroy();
    editor.setRootElement(null);
    root.remove();
  });

  it("restores read-only state only when the binding enabled editing", () => {
    const readOnlyEditor = createTestEditor();
    readOnlyEditor.setEditable(false);
    const readOnlyBinding = createLexicalBinding({
      editor: readOnlyEditor,
      replica: createBlockReplica("read-only-lifecycle"),
    });

    expect(readOnlyEditor.isEditable()).toBe(true);
    readOnlyBinding.destroy();
    expect(readOnlyEditor.isEditable()).toBe(false);

    const editableEditor = createTestEditor();
    editableEditor.setEditable(true);
    const editableBinding = createLexicalBinding({
      editor: editableEditor,
      replica: createBlockReplica("editable-lifecycle"),
    });

    editableBinding.destroy();
    expect(editableEditor.isEditable()).toBe(true);
  });

  it("captures backwards cross-block selections without normalizing direction", () => {
    const replica = createBlockReplica("selection");
    let blockIds: ReadonlyArray<string> = [];
    replica.transact((transaction) => {
      blockIds = transaction.replaceDocument({
        blocks: [
          { inputId: "first", type: "paragraph", text: "first" },
          { inputId: "second", type: "paragraph", text: "second" },
        ],
      });
    });
    const editor = createTestEditor();
    const binding = createLexicalBinding({ editor, replica });
    const firstKey = binding.getBlockIndex().blockIdToNodeKey.get(blockIds[0]!);
    const secondKey = binding
      .getBlockIndex()
      .blockIdToNodeKey.get(blockIds[1]!);
    if (firstKey === undefined || secondKey === undefined) {
      throw new Error("Expected both block keys");
    }

    editor.update(
      () => {
        const firstBlock = $getNodeByKey(firstKey);
        const secondBlock = $getNodeByKey(secondKey);
        const firstText = $isElementNode(firstBlock)
          ? firstBlock.getFirstChild()
          : null;
        const secondText = $isElementNode(secondBlock)
          ? secondBlock.getFirstChild()
          : null;
        if (!$isTextNode(firstText) || !$isTextNode(secondText)) {
          throw new Error("Expected text leaves");
        }
        const selection = $createRangeSelection();
        selection.anchor.set(secondText.getKey(), 4, "text");
        selection.focus.set(firstText.getKey(), 1, "text");
        $setSelection(selection);
      },
      { discrete: true },
    );

    const stable = binding.captureSelection();
    expect(stable).not.toBeNull();
    if (stable === null) throw new Error("Expected a stable selection");
    expect(binding.resolveSelection(stable)).toEqual({
      anchor: { blockId: blockIds[1], offset: 4 },
      focus: { blockId: blockIds[0], offset: 1 },
    });
    expect(JSON.parse(JSON.stringify(stable))).toEqual(stable);
    binding.destroy();
  });

  it("restores a forward same-block selection through a remote insert", () => {
    const localReplica = createBlockReplica("selection-local");
    const remoteReplica = createBlockReplica("selection-remote");
    const seedBatch = localReplica.transact((transaction) => {
      transaction.insertText(BOOTSTRAP_BLOCK_ID, 0, "abc");
    });
    if (seedBatch === null) throw new Error("Expected a seed batch");
    remoteReplica.applyRemoteEvents(seedBatch);
    const editor = createTestEditor();
    const binding = createLexicalBinding({ editor, replica: localReplica });
    const blockKey = binding
      .getBlockIndex()
      .blockIdToNodeKey.get(BOOTSTRAP_BLOCK_ID);
    if (blockKey === undefined) throw new Error("Expected the block key");

    editor.update(
      () => {
        const block = $getNodeByKey(blockKey);
        const text = $isElementNode(block) ? block.getFirstChild() : null;
        if (!$isTextNode(text)) throw new Error("Expected a text leaf");
        const selection = $createRangeSelection();
        selection.anchor.set(text.getKey(), 1, "text");
        selection.focus.set(text.getKey(), 2, "text");
        $setSelection(selection);
      },
      { discrete: true },
    );

    const remoteBatch = remoteReplica.transact((transaction) => {
      transaction.insertText(BOOTSTRAP_BLOCK_ID, 0, "X");
    });
    if (remoteBatch === null) throw new Error("Expected a remote batch");
    binding.applyRemoteEvents(remoteBatch);

    const stable = binding.captureSelection();
    if (stable === null) throw new Error("Expected a restored selection");
    expect(binding.resolveSelection(stable)).toEqual({
      anchor: { blockId: BOOTSTRAP_BLOCK_ID, offset: 2 },
      focus: { blockId: BOOTSTRAP_BLOCK_ID, offset: 3 },
    });
    binding.destroy();
  });

  it("preserves a block ID when Lexical replaces its node during a type conversion", () => {
    const replica = createBlockReplica("block-type-conversion");
    let blockIds: ReadonlyArray<string> = [];
    replica.transact((transaction) => {
      blockIds = transaction.replaceDocument({
        blocks: [
          { inputId: "first", type: "paragraph", text: "first" },
          { inputId: "second", type: "paragraph", text: "second" },
        ],
      });
    });
    const editor = createTestEditor();
    const binding = createLexicalBinding({ editor, replica });
    const secondKey = binding
      .getBlockIndex()
      .blockIdToNodeKey.get(blockIds[1]!);
    if (secondKey === undefined) throw new Error("Expected the second block");

    editor.update(
      () => {
        const second = $getNodeByKey(secondKey);
        if (!$isElementNode(second)) throw new Error("Expected a block");
        const heading = $createHeadingNode("h2");
        heading.append(...second.getChildren());
        second.replace(heading);
      },
      { discrete: true },
    );

    expect(replica.getDocument().blocks[1]).toMatchObject({
      id: blockIds[1],
      type: "h2",
      text: "second",
    });

    editor.update(
      () => {
        $getRoot().append(
          $createParagraphNode().append($createTextNode("second")),
        );
      },
      { discrete: true },
    );
    const afterCopy = replica.getDocument().blocks;
    expect(afterCopy.map(({ id }) => id)).toHaveLength(3);
    expect(new Set(afterCopy.map(({ id }) => id)).size).toBe(3);
    expect(afterCopy[1]?.id).toBe(blockIds[1]);
    binding.destroy();
  });

  it("does not emit a batch for semantically unchanged split text nodes and overlapping marks", () => {
    const replica = createBlockReplica("text-node-normalization");
    const editor = createTestEditor();
    const binding = createLexicalBinding({ editor, replica });
    const localChanges = vi.fn();
    replica.subscribe((change) => {
      if (change.origin === "local") localChanges(change);
    });

    editor.update(
      () => {
        const block = $getRoot().getFirstChild();
        if (!$isElementNode(block)) throw new Error("Expected a block");
        block
          .clear()
          .append(
            $createTextNode("a").toggleFormat("italic"),
            $createTextNode("a").toggleFormat("italic"),
            $createTextNode("b").toggleFormat("italic").toggleFormat("bold"),
            $createTextNode("c").toggleFormat("italic"),
          );
      },
      { discrete: true },
    );
    expect(localChanges).toHaveBeenCalledTimes(1);

    editor.update(
      () => {
        const block = $getRoot().getFirstChild();
        if (!$isElementNode(block)) throw new Error("Expected a block");
        block
          .clear()
          .append(
            $createTextNode("aa").toggleFormat("italic"),
            $createTextNode("b").toggleFormat("italic").toggleFormat("bold"),
            $createTextNode("c").toggleFormat("italic"),
          );
      },
      { discrete: true },
    );

    expect(localChanges).toHaveBeenCalledTimes(1);
    binding.destroy();
  });

  it("does not rewrite marks that span line-break and tab leaves", () => {
    const replica = createBlockReplica("marked-inline-leaves");
    let blockIds: ReadonlyArray<string> = [];
    replica.transact((transaction) => {
      blockIds = transaction.replaceDocument({
        blocks: [
          {
            inputId: "marked",
            type: "paragraph",
            text: "a\n\tb",
            marks: [{ kind: "bold", from: 0, to: 4, value: true }],
          },
          { inputId: "edited", type: "paragraph", text: "before" },
        ],
      });
    });
    const editor = createTestEditor();
    const binding = createLexicalBinding({ editor, replica });
    const localChanges = vi.fn();
    replica.subscribe((change) => {
      if (change.origin === "local") localChanges(change);
    });
    const editedKey = binding
      .getBlockIndex()
      .blockIdToNodeKey.get(blockIds[1]!);
    if (editedKey === undefined) throw new Error("Expected the edited block");

    editor.update(
      () => {
        const edited = $getNodeByKey(editedKey);
        if (!$isElementNode(edited)) throw new Error("Expected a block");
        edited.clear().append($createTextNode("after"));
      },
      { discrete: true },
    );

    expect(localChanges).toHaveBeenCalledTimes(1);
    expect(replica.getDocument().blocks[0]?.marks).toEqual([
      { kind: "bold", from: 0, to: 4, value: true },
    ]);
    binding.destroy();
  });

  it("preserves incompatible ordered-list numbering across unrelated edits", () => {
    const replica = createBlockReplica("numbered-list-boundaries");
    let blockIds: ReadonlyArray<string> = [];
    replica.transact((transaction) => {
      blockIds = transaction.replaceDocument({
        blocks: [
          {
            inputId: "one",
            type: "number-list",
            text: "one",
            attrs: { start: 1, value: 1 },
          },
          {
            inputId: "two",
            type: "number-list",
            text: "two",
            attrs: { start: 1, value: 2 },
          },
          {
            inputId: "ten",
            type: "number-list",
            text: "ten",
            attrs: { start: 10, value: 10 },
          },
          {
            inputId: "eleven",
            type: "number-list",
            text: "eleven",
            attrs: { start: 10, value: 11 },
          },
          { inputId: "edited", type: "paragraph", text: "before" },
        ],
      });
    });
    const editor = createTestEditor();
    const binding = createLexicalBinding({ editor, replica });
    const readValues = (): ReadonlyArray<number> =>
      editor.getEditorState().read(() => {
        const list = $getRoot().getFirstChild();
        if (!$isListNode(list)) throw new Error("Expected an ordered list");
        return list.getChildren().map((child) => {
          if (!$isListItemNode(child)) throw new Error("Expected a list item");
          return child.getValue();
        });
      });

    expect(readValues()).toEqual([1, 2, 10, 11]);
    const blockIndex = binding.getBlockIndex();
    expect(Object.keys(blockIndex).sort()).toEqual([
      "blockIdToNodeKey",
      "nodeKeyToBlockId",
    ]);

    const localChanges = vi.fn();
    replica.subscribe((change) => {
      if (change.origin === "local") localChanges(change);
    });
    const editedKey = binding
      .getBlockIndex()
      .blockIdToNodeKey.get(blockIds[4]!);
    if (editedKey === undefined) throw new Error("Expected the edited block");
    editor.update(
      () => {
        const edited = $getNodeByKey(editedKey);
        if (!$isElementNode(edited)) throw new Error("Expected a block");
        edited.clear().append($createTextNode("after"));
      },
      { discrete: true },
    );

    expect(localChanges).toHaveBeenCalledTimes(1);
    expect(readValues()).toEqual([1, 2, 10, 11]);
    expect(
      replica
        .getDocument()
        .blocks.slice(0, 4)
        .map(({ attrs }) => attrs),
    ).toMatchObject([
      { start: 1, value: 1 },
      { start: 1, value: 2 },
      { start: 10, value: 10 },
      { start: 10, value: 11 },
    ]);

    const tenKey = binding.getBlockIndex().blockIdToNodeKey.get(blockIds[2]!);
    if (tenKey === undefined) throw new Error("Expected the ten list item");
    editor.update(
      () => {
        const ten = $getNodeByKey(tenKey);
        if (!$isListItemNode(ten)) throw new Error("Expected a list item");
        ten.clear().append($createTextNode("ten updated"));
      },
      { discrete: true },
    );

    expect(localChanges).toHaveBeenCalledTimes(2);
    expect(readValues()).toEqual([1, 2, 10, 11]);
    expect(replica.getDocument().blocks[2]).toMatchObject({
      id: blockIds[2],
      type: "number-list",
      text: "ten updated",
      attrs: { start: 10, value: 10 },
    });
    binding.destroy();
  });

  it("continues numbering after an ordered-list reset when inserting an item", () => {
    const replica = createBlockReplica("numbered-list-insertion");
    let blockIds: ReadonlyArray<string> = [];
    replica.transact((transaction) => {
      blockIds = transaction.replaceDocument({
        blocks: [
          {
            inputId: "one",
            type: "number-list",
            text: "one",
            attrs: { start: 1, value: 1 },
          },
          {
            inputId: "two",
            type: "number-list",
            text: "two",
            attrs: { start: 1, value: 2 },
          },
          {
            inputId: "ten",
            type: "number-list",
            text: "ten",
            attrs: { start: 10, value: 10 },
          },
          {
            inputId: "twelve",
            type: "number-list",
            text: "twelve",
            attrs: { start: 10, value: 11 },
          },
        ],
      });
    });
    const editor = createTestEditor();
    const binding = createLexicalBinding({ editor, replica });
    const tenKey = binding.getBlockIndex().blockIdToNodeKey.get(blockIds[2]!);
    if (tenKey === undefined) throw new Error("Expected the ten list item");

    editor.update(
      () => {
        const ten = $getNodeByKey(tenKey);
        if (!$isListItemNode(ten)) throw new Error("Expected a list item");
        ten.insertAfter(
          $createListItemNode().append($createTextNode("eleven")),
        );
      },
      { discrete: true },
    );

    expect(
      editor.getEditorState().read(() => {
        const list = $getRoot().getFirstChild();
        if (!$isListNode(list)) throw new Error("Expected an ordered list");
        return list.getChildren().map((child) => {
          if (!$isListItemNode(child)) throw new Error("Expected a list item");
          return child.getValue();
        });
      }),
    ).toEqual([1, 2, 10, 11, 12]);
    expect(
      replica.getDocument().blocks.map(({ text, attrs }) => ({
        text,
        start: attrs.start,
        value: attrs.value,
      })),
    ).toEqual([
      { text: "one", start: 1, value: 1 },
      { text: "two", start: 1, value: 2 },
      { text: "ten", start: 10, value: 10 },
      { text: "eleven", start: 10, value: 11 },
      { text: "twelve", start: 10, value: 12 },
    ]);
    binding.destroy();
  });

  it("keeps an insertion before the reset in the preceding number segment", () => {
    const replica = createBlockReplica("numbered-list-before-reset");
    let blockIds: ReadonlyArray<string> = [];
    replica.transact((transaction) => {
      blockIds = transaction.replaceDocument({
        blocks: [
          {
            inputId: "one",
            type: "number-list",
            text: "one",
            attrs: { start: 1, value: 1 },
          },
          {
            inputId: "two",
            type: "number-list",
            text: "two",
            attrs: { start: 1, value: 2 },
          },
          {
            inputId: "ten",
            type: "number-list",
            text: "ten",
            attrs: { start: 10, value: 10 },
          },
          {
            inputId: "eleven",
            type: "number-list",
            text: "eleven",
            attrs: { start: 10, value: 11 },
          },
        ],
      });
    });
    const editor = createTestEditor();
    const binding = createLexicalBinding({ editor, replica });
    const twoKey = binding.getBlockIndex().blockIdToNodeKey.get(blockIds[1]!);
    if (twoKey === undefined) throw new Error("Expected the two list item");

    editor.update(
      () => {
        const two = $getNodeByKey(twoKey);
        if (!$isListItemNode(two)) throw new Error("Expected a list item");
        two.insertAfter($createListItemNode().append($createTextNode("three")));
      },
      { discrete: true },
    );

    expect(
      editor.getEditorState().read(() => {
        const list = $getRoot().getFirstChild();
        if (!$isListNode(list)) throw new Error("Expected an ordered list");
        return list.getChildren().map((child) => {
          if (!$isListItemNode(child)) throw new Error("Expected a list item");
          return child.getValue();
        });
      }),
    ).toEqual([1, 2, 3, 10, 11]);
    expect(
      replica.getDocument().blocks.map(({ text, attrs }) => ({
        text,
        start: attrs.start,
        value: attrs.value,
      })),
    ).toEqual([
      { text: "one", start: 1, value: 1 },
      { text: "two", start: 1, value: 2 },
      { text: "three", start: 1, value: 3 },
      { text: "ten", start: 10, value: 10 },
      { text: "eleven", start: 10, value: 11 },
    ]);
    binding.destroy();
  });

  it("transfers a deleted reset to the next surviving list item", () => {
    const replica = createBlockReplica("numbered-list-deleted-reset");
    let blockIds: ReadonlyArray<string> = [];
    replica.transact((transaction) => {
      blockIds = transaction.replaceDocument({
        blocks: [
          {
            inputId: "one",
            type: "number-list",
            text: "one",
            attrs: { start: 1, value: 1 },
          },
          {
            inputId: "two",
            type: "number-list",
            text: "two",
            attrs: { start: 1, value: 2 },
          },
          {
            inputId: "ten",
            type: "number-list",
            text: "ten",
            attrs: { start: 10, value: 10 },
          },
          {
            inputId: "eleven",
            type: "number-list",
            text: "eleven",
            attrs: { start: 10, value: 11 },
          },
        ],
      });
    });
    const editor = createTestEditor();
    const binding = createLexicalBinding({ editor, replica });
    const tenKey = binding.getBlockIndex().blockIdToNodeKey.get(blockIds[2]!);
    if (tenKey === undefined) throw new Error("Expected the ten list item");

    editor.update(
      () => {
        const ten = $getNodeByKey(tenKey);
        if (!$isListItemNode(ten)) throw new Error("Expected a list item");
        ten.remove();
      },
      { discrete: true },
    );

    expect(
      editor.getEditorState().read(() => {
        const list = $getRoot().getFirstChild();
        if (!$isListNode(list)) throw new Error("Expected an ordered list");
        return list.getChildren().map((child) => {
          if (!$isListItemNode(child)) throw new Error("Expected a list item");
          return child.getValue();
        });
      }),
    ).toEqual([1, 2, 10]);
    expect(replica.getDocument().blocks[2]).toMatchObject({
      id: blockIds[3],
      text: "eleven",
      attrs: { start: 10, value: 10 },
    });
    binding.destroy();
  });

  it("preserves a start-only reset when replacing its list item", () => {
    const replica = createBlockReplica("numbered-list-replacement");
    let blockIds: ReadonlyArray<string> = [];
    replica.transact((transaction) => {
      blockIds = transaction.replaceDocument({
        blocks: [
          {
            inputId: "one",
            type: "number-list",
            text: "one",
            attrs: { start: 1, value: 1 },
          },
          {
            inputId: "ten",
            type: "number-list",
            text: "ten",
            attrs: { start: 10 },
          },
          {
            inputId: "eleven",
            type: "number-list",
            text: "eleven",
            attrs: { start: 10, value: 11 },
          },
        ],
      });
    });
    const editor = createTestEditor();
    const binding = createLexicalBinding({ editor, replica });
    const tenKey = binding.getBlockIndex().blockIdToNodeKey.get(blockIds[1]!);
    if (tenKey === undefined) throw new Error("Expected the ten list item");

    editor.update(
      () => {
        const ten = $getNodeByKey(tenKey);
        if (!$isListItemNode(ten)) throw new Error("Expected a list item");
        ten.replace(
          $createListItemNode().append($createTextNode("ten replaced")),
        );
      },
      { discrete: true },
    );

    expect(
      editor.getEditorState().read(() => {
        const list = $getRoot().getFirstChild();
        if (!$isListNode(list)) throw new Error("Expected an ordered list");
        return list.getChildren().map((child) => {
          if (!$isListItemNode(child)) throw new Error("Expected a list item");
          return child.getValue();
        });
      }),
    ).toEqual([1, 10, 11]);
    expect(replica.getDocument().blocks[1]).toMatchObject({
      id: blockIds[1],
      type: "number-list",
      text: "ten replaced",
      attrs: { start: 10, value: null },
    });
    binding.destroy();
  });

  it("remaps an equivalent replacement list item to its stable block", () => {
    const replica = createBlockReplica("numbered-list-equivalent-replacement");
    let blockIds: ReadonlyArray<string> = [];
    replica.transact((transaction) => {
      blockIds = transaction.replaceDocument({
        blocks: [
          {
            inputId: "one",
            type: "number-list",
            text: "one",
            attrs: { start: 1, value: 1 },
          },
          {
            inputId: "ten",
            type: "number-list",
            text: "ten",
            attrs: { start: 10, value: 10 },
          },
        ],
      });
    });
    const editor = createTestEditor();
    const binding = createLexicalBinding({ editor, replica });
    const oldKey = binding.getBlockIndex().blockIdToNodeKey.get(blockIds[1]!);
    if (oldKey === undefined) throw new Error("Expected the ten list item");
    let replacementKey = "";

    editor.update(
      () => {
        const ten = $getNodeByKey(oldKey);
        if (!$isListItemNode(ten)) throw new Error("Expected a list item");
        const text = $createTextNode("ten");
        const replacement = $createListItemNode().append(text);
        replacementKey = replacement.getKey();
        ten.replace(replacement);
        text.selectEnd();
      },
      { discrete: true },
    );

    const blockIndex = binding.getBlockIndex();
    expect(replacementKey).not.toBe(oldKey);
    expect(blockIndex.blockIdToNodeKey.get(blockIds[1]!)).toBe(replacementKey);
    expect(blockIndex.nodeKeyToBlockId.get(replacementKey)).toBe(blockIds[1]);
    expect(blockIndex.nodeKeyToBlockId.has(oldKey)).toBe(false);
    expect(
      editor.getEditorState().read(() => {
        const replacement = $getNodeByKey(replacementKey);
        if (!$isListItemNode(replacement)) {
          throw new Error("Expected the replacement list item");
        }
        return replacement.getValue();
      }),
    ).toBe(10);
    const selection = binding.captureSelection();
    expect(selection).not.toBeNull();
    if (selection === null) throw new Error("Expected a stable selection");
    expect(binding.resolveSelection(selection)).toEqual({
      anchor: { blockId: blockIds[1], offset: 3 },
      focus: { blockId: blockIds[1], offset: 3 },
    });
    binding.destroy();
  });

  it("publishes selection when an equivalent link node is rebuilt", () => {
    const replica = createBlockReplica("link-selection");
    const editor = createTestEditor();
    const onSelectionChange = vi.fn();
    const binding = createLexicalBinding({
      editor,
      replica,
      onSelectionChange,
    });
    const setLinkedSelection = (offset: number): void => {
      const block = $getRoot().getFirstChild();
      if (!$isElementNode(block)) throw new Error("Expected a block");
      const text = $createTextNode("link");
      block.clear().append($createLinkNode("https://example.com").append(text));
      const selection = $createRangeSelection();
      selection.anchor.set(text.getKey(), offset, "text");
      selection.focus.set(text.getKey(), offset, "text");
      $setSelection(selection);
    };

    editor.update(() => setLinkedSelection(1), { discrete: true });
    expect(onSelectionChange).toHaveBeenCalledTimes(1);
    onSelectionChange.mockClear();

    editor.update(() => setLinkedSelection(3), { discrete: true });

    expect(onSelectionChange).toHaveBeenCalledTimes(1);
    const stable = onSelectionChange.mock.calls[0]?.[0];
    if (stable === null || stable === undefined) {
      throw new Error("Expected a stable selection");
    }
    expect(binding.resolveSelection(stable)).toEqual({
      anchor: { blockId: BOOTSTRAP_BLOCK_ID, offset: 3 },
      focus: { blockId: BOOTSTRAP_BLOCK_ID, offset: 3 },
    });
    binding.destroy();
  });

  it("reports unsupported nodes and removes listeners on destroy", () => {
    const replica = createBlockReplica("cleanup");
    const editor = createTestEditor();
    const onError = vi.fn();
    const binding = createLexicalBinding({ editor, replica, onError });

    editor.update(
      () => {
        $getRoot()
          .clear()
          .append(
            $createHeadingNode("h4").append($createTextNode("unsupported")),
          );
      },
      { discrete: true },
    );
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ name: "UnsupportedLexicalNodeError" }),
    );
    expect(replica.exportEvents()).toHaveLength(1);

    binding.destroy();
    editor.update(
      () => {
        $getRoot()
          .clear()
          .append(
            $createParagraphNode().append($createTextNode("after destroy")),
          );
      },
      { discrete: true },
    );
    expect(replica.exportEvents()).toHaveLength(1);
  });
});
