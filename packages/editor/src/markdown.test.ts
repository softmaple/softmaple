import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  createEditor,
} from "lexical";
import { describe, expect, it } from "vitest";
import { lexicalEditorToMarkdown } from "./markdown";

describe("Lexical Markdown derivation", () => {
  it("derives Markdown from the current editor state", () => {
    const editor = createEditor();
    editor.update(
      () => {
        $getRoot().append(
          $createParagraphNode().append($createTextNode("Durable text")),
        );
      },
      { discrete: true },
    );

    expect(lexicalEditorToMarkdown(editor)).toBe("Durable text");
  });
});
