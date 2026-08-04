import { $createCodeNode, CodeNode } from "@lexical/code";
import { $createLinkNode, LinkNode } from "@lexical/link";
import {
  $createListItemNode,
  $createListNode,
  ListItemNode,
  ListNode,
} from "@lexical/list";
import {
  $createHeadingNode,
  $createQuoteNode,
  HeadingNode,
  QuoteNode,
} from "@lexical/rich-text";
import {
  $createLineBreakNode,
  $createParagraphNode,
  $createTabNode,
  $createTextNode,
  $getRoot,
  $isParagraphNode,
  $isTabNode,
  createEditor,
  type LexicalEditor,
} from "lexical";
import { describe, expect, it } from "vitest";
import { UnsupportedLexicalNodeError } from "./errors";
import { projectLexicalDocument } from "./lexical-to-projection";
import {
  materializeLexicalDocument,
  type MaterializedDocument,
} from "./projection-to-lexical";

const createTestEditor = (): LexicalEditor =>
  createEditor({
    namespace: "binding-lexical-test",
    nodes: [HeadingNode, QuoteNode, CodeNode, LinkNode, ListNode, ListItemNode],
    onError: (error) => {
      throw error;
    },
  });

const readProjection = (editor: LexicalEditor) =>
  editor.getEditorState().read(() => projectLexicalDocument());

describe("Lexical projection", () => {
  it("projects every v1 top-level node and UTF-16 inline leaf", () => {
    const editor = createTestEditor();
    editor.update(
      () => {
        const paragraph = $createParagraphNode();
        const first = $createTextNode("A").toggleFormat("bold");
        const second = $createTextNode("😀").toggleFormat("bold");
        const link = $createLinkNode("https://softmaple.example", {
          target: "_blank",
        });
        link.append($createTextNode("link").toggleFormat("italic"));
        paragraph.append(
          first,
          second,
          $createLineBreakNode(),
          $createTabNode(),
          link,
        );

        const code = $createCodeNode("typescript");
        code.append($createTextNode("const n = 1;"));
        $getRoot().append(
          paragraph,
          $createHeadingNode("h1").append($createTextNode("One")),
          $createHeadingNode("h2").append($createTextNode("Two")),
          $createHeadingNode("h3").append($createTextNode("Three")),
          $createQuoteNode().append($createTextNode("Quote")),
          code,
        );
      },
      { discrete: true },
    );

    const projection = readProjection(editor);
    expect(projection.blocks.map((block) => block.type)).toEqual([
      "paragraph",
      "h1",
      "h2",
      "h3",
      "quote",
      "code",
    ]);
    expect(projection.blocks[0]?.text).toBe("A😀\n\tlink");
    expect(projection.blocks[0]?.marks).toEqual([
      { kind: "bold", from: 0, to: 3 },
      { kind: "italic", from: 5, to: 9 },
      {
        kind: "link",
        from: 5,
        to: 9,
        value: {
          url: "https://softmaple.example",
          target: "_blank",
        },
      },
    ]);
    expect(projection.blocks[5]?.attributes.language).toBe("typescript");
  });

  it("projects every supported inline text format independently", () => {
    const editor = createTestEditor();
    editor.update(
      () => {
        $getRoot().append(
          $createParagraphNode().append(
            $createTextNode("b").toggleFormat("bold"),
            $createTextNode("i").toggleFormat("italic"),
            $createTextNode("u").toggleFormat("underline"),
            $createTextNode("s").toggleFormat("strikethrough"),
            $createTextNode("c").toggleFormat("code"),
          ),
        );
      },
      { discrete: true },
    );

    expect(readProjection(editor).blocks[0]).toMatchObject({
      text: "biusc",
      marks: [
        { kind: "bold", from: 0, to: 1 },
        { kind: "italic", from: 1, to: 2 },
        { kind: "underline", from: 2, to: 3 },
        { kind: "strike", from: 3, to: 4 },
        { kind: "inline-code", from: 4, to: 5 },
      ],
    });
  });

  it("uses substantive list items as blocks and skips structural wrappers", () => {
    const editor = createTestEditor();
    editor.update(
      () => {
        const outer = $createListNode("check");
        const parent = $createListItemNode(true).append(
          $createTextNode("todo"),
        );
        const nested = $createListNode("bullet").append(
          $createListItemNode().append($createTextNode("detail")),
        );
        const wrapper = $createListItemNode().append(nested);
        outer.append(parent, wrapper);
        $getRoot().append(outer);
      },
      { discrete: true },
    );

    const projection = readProjection(editor);
    expect(projection.blocks).toHaveLength(2);
    expect(projection.blocks[0]).toMatchObject({
      type: "check-list",
      text: "todo",
    });
    expect(projection.blocks[0]?.attributes).toEqual({ checked: true });
    expect(projection.blocks[1]).toMatchObject({
      type: "bullet-list",
      text: "detail",
    });
    expect(projection.blocks[1]?.attributes).toEqual({});
    expect(projection.blocks[1]?.parentSourceKey).toBe(
      projection.blocks[0]?.sourceKey,
    );
  });

  it("rejects unsupported nodes and inline styling explicitly", () => {
    const editor = createTestEditor();
    editor.update(
      () => {
        $getRoot().append(
          $createHeadingNode("h4").append($createTextNode("Nope")),
        );
      },
      { discrete: true },
    );
    expect(() => readProjection(editor)).toThrow(UnsupportedLexicalNodeError);

    editor.update(
      () => {
        $getRoot()
          .clear()
          .append(
            $createParagraphNode().append(
              $createTextNode("styled").setStyle("color: red"),
            ),
          );
      },
      { discrete: true },
    );
    expect(() => readProjection(editor)).toThrow(/arbitrary inline CSS/);
  });

  it("round-trips nested lists, marks, line breaks, and tabs", () => {
    const editor = createTestEditor();
    const document: MaterializedDocument = {
      blocks: [
        {
          id: "parent",
          type: "number-list",
          text: "parent",
          marks: [{ kind: "bold", from: 0, to: 6 }],
          attributes: { start: 4, value: 4 },
        },
        {
          id: "child",
          parentId: "parent",
          type: "check-list",
          text: "child\n\tlink",
          marks: [
            {
              kind: "link",
              from: 8,
              to: 12,
              value: { url: "https://example.com" },
            },
          ],
          attributes: { checked: false },
        },
      ],
    };
    let indexSize = 0;
    editor.update(
      () => {
        indexSize = materializeLexicalDocument(document).blockIdToNodeKey.size;
      },
      { discrete: true },
    );

    expect(indexSize).toBe(2);
    const projection = readProjection(editor);
    expect(projection.blocks.map(({ type, text }) => ({ type, text }))).toEqual(
      [
        { type: "number-list", text: "parent" },
        { type: "check-list", text: "child\n\tlink" },
      ],
    );
    expect(projection.blocks[1]?.parentSourceKey).toBe(
      projection.blocks[0]?.sourceKey,
    );
  });

  it("canonicalizes matching marks across line-break and tab leaves", () => {
    const editor = createTestEditor();
    const document: MaterializedDocument = {
      blocks: [
        {
          id: "marked-inline-leaves",
          type: "paragraph",
          text: "a\n\tb",
          marks: [
            { kind: "bold", from: 0, to: 4 },
            {
              kind: "link",
              from: 0,
              to: 4,
              value: { url: "https://example.com" },
            },
          ],
        },
      ],
    };

    editor.update(
      () => {
        materializeLexicalDocument(document);
      },
      { discrete: true },
    );

    expect(readProjection(editor).blocks[0]?.marks).toEqual(
      document.blocks[0]?.marks,
    );
  });

  it("preserves whether a tab is included in an inline mark", () => {
    const editor = createTestEditor();
    editor.update(
      () => {
        const paragraph = $createParagraphNode();
        paragraph.append(
          $createTextNode("a").toggleFormat("bold"),
          $createTabNode(),
          $createTextNode("b").toggleFormat("bold"),
        );
        $getRoot().append(paragraph);
      },
      { discrete: true },
    );

    expect(readProjection(editor).blocks[0]?.marks).toEqual([
      { kind: "bold", from: 0, to: 1 },
      { kind: "bold", from: 2, to: 3 },
    ]);

    editor.update(
      () => {
        const paragraph = $getRoot().getFirstChild();
        if (!$isParagraphNode(paragraph)) throw new Error("Expected paragraph");
        const tab = paragraph.getChildAtIndex(1);
        if (!$isTabNode(tab)) throw new Error("Expected tab");
        tab.toggleFormat("bold");
      },
      { discrete: true },
    );

    expect(readProjection(editor).blocks[0]?.marks).toEqual([
      { kind: "bold", from: 0, to: 3 },
    ]);
  });

  it("preserves interleaved nested list type order", () => {
    const editor = createTestEditor();
    const document: MaterializedDocument = {
      blocks: [
        {
          id: "parent",
          type: "number-list",
          text: "parent",
          marks: [],
        },
        {
          id: "first",
          parentId: "parent",
          type: "bullet-list",
          text: "first",
          marks: [],
        },
        {
          id: "second",
          parentId: "parent",
          type: "check-list",
          text: "second",
          marks: [],
        },
        {
          id: "third",
          parentId: "parent",
          type: "bullet-list",
          text: "third",
          marks: [],
        },
      ],
    };

    editor.update(
      () => {
        materializeLexicalDocument(document);
      },
      { discrete: true },
    );

    expect(readProjection(editor).blocks.map(({ text }) => text)).toEqual([
      "parent",
      "first",
      "second",
      "third",
    ]);
  });
});
