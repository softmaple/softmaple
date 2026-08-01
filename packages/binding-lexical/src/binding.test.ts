import { CodeNode } from "@lexical/code";
import { $createLinkNode, LinkNode } from "@lexical/link";
import { ListItemNode, ListNode } from "@lexical/list";
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
