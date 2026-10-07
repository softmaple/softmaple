import {
  BLOCK_MODEL_SCHEMA_VERSION,
  BOOTSTRAP_BLOCK_ID,
  BOOTSTRAP_EVENT_ID,
  createBlockReplica,
  type BlockReplicaOrigin,
  type RichTextEventBatch,
} from "@softmaple/block-model";
import { createEditor } from "lexical";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createLexicalBinding } from "./binding";
import { projectLexicalDocument } from "./lexical-to-projection";

/**
 * More batches than one call can take as arguments: the small-stack project in
 * vitest.config.ts runs this file with a 128 KiB stack, which holds at most
 * 16,384 of them.
 */
const BATCH_COUNT = 20_000;

describe("createLexicalBinding with more batches than a spread can pass", () => {
  beforeAll(() => {
    expect(
      () => [].push(...new Array<never>(BATCH_COUNT)),
      "this file must run with the small-stack project's --stack-size",
    ).toThrow(RangeError);
  });

  it("buffers them during IME and applies them when composition ends", async () => {
    const replica = createBlockReplica("ime-large");
    const editor = createEditor({
      namespace: "binding-large-delivery",
      onError: (error) => {
        throw error;
      },
    });
    const root = document.createElement("div");
    root.contentEditable = "true";
    document.body.append(root);
    editor.setRootElement(root);
    const onError = vi.fn();
    const binding = createLexicalBinding({ editor, replica, onError });
    const changes: { origin: BlockReplicaOrigin; batches: number }[] = [];
    replica.subscribe(({ origin, batchIds }) => {
      changes.push({ origin, batches: batchIds.length });
    });

    root.dispatchEvent(new CompositionEvent("compositionstart"));
    expect(binding.applyRemoteEvents(typingHistory(BATCH_COUNT))).toBeNull();
    expect(replica.getDocument().blocks[0]?.text).toBe("");

    root.dispatchEvent(new CompositionEvent("compositionend"));
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    await new Promise<void>((resolve) => queueMicrotask(resolve));

    expect(onError).not.toHaveBeenCalled();
    expect(changes).toEqual([{ origin: "remote", batches: BATCH_COUNT }]);
    const text = "a".repeat(BATCH_COUNT);
    expect(replica.getDocument().blocks[0]?.text).toBe(text);
    expect(
      editor
        .getEditorState()
        .read(() => projectLexicalDocument().blocks.map((block) => block.text)),
    ).toEqual([text]);

    binding.destroy();
    editor.setRootElement(null);
    root.remove();
  });
});

/** One author typing `count` characters, one single-event batch each. */
const typingHistory = (count: number): RichTextEventBatch[] =>
  Array.from({ length: count }, (_, index) => {
    const id = `history:${index}`;
    const parentVersion = [
      index === 0 ? BOOTSTRAP_EVENT_ID : `history:${index - 1}`,
    ];
    return {
      schemaVersion: BLOCK_MODEL_SCHEMA_VERSION,
      batchId: id,
      parentVersion,
      events: [
        {
          schemaVersion: BLOCK_MODEL_SCHEMA_VERSION,
          id,
          parentVersion,
          timestamp: index + 1,
          operation: { type: "insert", index: index + 1, text: "a" },
          effect: {
            type: "text-insert",
            blockId: BOOTSTRAP_BLOCK_ID,
            text: "a",
          },
        },
      ],
    };
  });
