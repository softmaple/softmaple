import { $createCodeNode } from "@lexical/code";
import { $createLinkNode } from "@lexical/link";
import {
  $createListItemNode,
  $createListNode,
  $isListNode,
  type ListItemNode,
  type ListNode,
  type ListType,
} from "@lexical/list";
import { $createHeadingNode, $createQuoteNode } from "@lexical/rich-text";
import {
  $createLineBreakNode,
  $createParagraphNode,
  $createTabNode,
  $createTextNode,
  $getRoot,
  type ElementNode,
  type LexicalNode,
  type NodeKey,
  type TextNode,
  type TextFormatType,
} from "lexical";
import type {
  ProjectedBlockAttributes,
  ProjectedBlockType,
  ProjectedLinkValue,
  ProjectedMark,
} from "./projection-types";

export interface MaterializedBlock {
  readonly id: string;
  readonly parentId?: string | null;
  readonly type: ProjectedBlockType;
  readonly text: string;
  readonly marks: ReadonlyArray<ProjectedMark>;
  readonly attributes?: ProjectedBlockAttributes;
}

export interface MaterializedDocument {
  readonly blocks: ReadonlyArray<MaterializedBlock>;
}

export interface LexicalBlockIndex {
  readonly blockIdToNodeKey: ReadonlyMap<string, NodeKey>;
  readonly nodeKeyToBlockId: ReadonlyMap<NodeKey, string>;
}

const textFormats: ReadonlyArray<
  readonly [ProjectedMark["kind"], TextFormatType]
> = [
  ["bold", "bold"],
  ["italic", "italic"],
  ["underline", "underline"],
  ["strike", "strikethrough"],
  ["inline-code", "code"],
];

const activeMarks = (
  marks: ReadonlyArray<ProjectedMark>,
  from: number,
  to: number,
): ReadonlyArray<ProjectedMark> =>
  marks.filter((mark) => mark.from <= from && mark.to >= to);

const appendMarkedTextNode = (
  parent: ElementNode,
  textNode: TextNode,
  marks: ReadonlyArray<ProjectedMark>,
): void => {
  for (const [kind, format] of textFormats) {
    if (marks.some((mark) => mark.kind === kind)) {
      textNode.toggleFormat(format);
    }
  }
  const link = marks.find((mark) => mark.kind === "link");
  if (link === undefined) {
    parent.append(textNode);
    return;
  }
  if (link.value === undefined) {
    throw new Error("A materialized link mark must have a value");
  }
  const linkNode = createLink(link.value);
  linkNode.append(textNode);
  parent.append(linkNode);
};

const appendTextRun = (
  parent: ElementNode,
  text: string,
  marks: ReadonlyArray<ProjectedMark>,
): void => appendMarkedTextNode(parent, $createTextNode(text), marks);

const createLink = (value: ProjectedLinkValue) =>
  $createLinkNode(value.url, {
    target: value.target ?? undefined,
    rel: value.rel ?? undefined,
    title: value.title ?? undefined,
  });

const appendInlineContent = (
  parent: ElementNode,
  text: string,
  marks: ReadonlyArray<ProjectedMark>,
): void => {
  const boundaries = new Set<number>([0, text.length]);
  for (const mark of marks) {
    boundaries.add(Math.max(0, Math.min(text.length, mark.from)));
    boundaries.add(Math.max(0, Math.min(text.length, mark.to)));
  }
  for (let index = 0; index < text.length; index++) {
    if (text[index] === "\n" || text[index] === "\t") {
      boundaries.add(index);
      boundaries.add(index + 1);
    }
  }
  const ordered = [...boundaries].sort((left, right) => left - right);
  let openLinkNode: ReturnType<typeof createLink> | null = null;
  let openLinkValue: ProjectedLinkValue | null = null;
  const sameLink = (
    left: ProjectedLinkValue,
    right: ProjectedLinkValue,
  ): boolean =>
    left.url === right.url &&
    (left.target ?? null) === (right.target ?? null) &&
    (left.rel ?? null) === (right.rel ?? null) &&
    (left.title ?? null) === (right.title ?? null);

  for (let index = 0; index < ordered.length - 1; index++) {
    const from = ordered[index];
    const to = ordered[index + 1];
    if (from === undefined || to === undefined || from === to) continue;
    const content = text.slice(from, to);
    const segmentMarks = activeMarks(marks, from, to);
    const link = segmentMarks.find((mark) => mark.kind === "link");
    if (content === "\n") {
      openLinkNode = null;
      openLinkValue = null;
      parent.append($createLineBreakNode());
      continue;
    }
    if (content === "\t") {
      openLinkNode = null;
      openLinkValue = null;
      appendMarkedTextNode(parent, $createTabNode(), segmentMarks);
      continue;
    }
    if (link?.value !== undefined) {
      if (
        openLinkNode !== null &&
        openLinkValue !== null &&
        sameLink(openLinkValue, link.value)
      ) {
        openLinkNode.append($createTextNode(content));
        continue;
      }
      const textNode = $createTextNode(content);
      for (const [kind, format] of textFormats) {
        if (segmentMarks.some((mark) => mark.kind === kind)) {
          textNode.toggleFormat(format);
        }
      }
      openLinkNode = createLink(link.value);
      openLinkValue = link.value;
      openLinkNode.append(textNode);
      parent.append(openLinkNode);
      continue;
    }
    openLinkNode = null;
    openLinkValue = null;
    appendTextRun(parent, content, segmentMarks);
  }
};

const createTextBlock = (block: MaterializedBlock): ElementNode => {
  const attributes = block.attributes;
  let element: ElementNode;
  switch (block.type) {
    case "paragraph":
      element = $createParagraphNode();
      break;
    case "h1":
    case "h2":
    case "h3":
      element = $createHeadingNode(block.type);
      break;
    case "quote":
      element = $createQuoteNode();
      break;
    case "code": {
      const code = $createCodeNode(attributes?.language ?? undefined);
      if (attributes?.theme !== undefined) {
        code.setTheme(attributes.theme);
      }
      element = code;
      break;
    }
    default:
      throw new Error(`Expected a text block, received ${block.type}`);
  }
  appendInlineContent(element, block.text, block.marks);
  return element;
};

const lexicalListType = (type: ProjectedBlockType): ListType => {
  switch (type) {
    case "bullet-list":
      return "bullet";
    case "number-list":
      return "number";
    case "check-list":
      return "check";
    default:
      throw new Error(`Expected a list block, received ${type}`);
  }
};

const isListBlock = (type: ProjectedBlockType): boolean =>
  type === "bullet-list" || type === "number-list" || type === "check-list";

const createListItem = (block: MaterializedBlock): ListItemNode => {
  const checked =
    block.type === "check-list" ? block.attributes?.checked : undefined;
  const item = $createListItemNode(checked);
  if (block.attributes?.value !== undefined) {
    item.setValue(block.attributes.value);
  }
  appendInlineContent(item, block.text, block.marks);
  return item;
};

interface ActiveChildList {
  readonly type: ListType;
  readonly node: ListNode;
}

/** Replace the Lexical root in one update and rebuild the temporary ID map. */
export const materializeLexicalDocument = (
  document: MaterializedDocument,
): LexicalBlockIndex => {
  const root = $getRoot();
  root.clear();
  const blockIdToNodeKey = new Map<string, NodeKey>();
  const nodeKeyToBlockId = new Map<NodeKey, string>();
  const listItems = new Map<string, ListItemNode>();
  const activeChildLists = new Map<string, ActiveChildList>();
  let activeTopList: ListNode | null = null;

  const remember = (blockId: string, node: LexicalNode): void => {
    blockIdToNodeKey.set(blockId, node.getKey());
    nodeKeyToBlockId.set(node.getKey(), blockId);
  };

  for (const block of document.blocks) {
    if (!isListBlock(block.type)) {
      activeTopList = null;
      const element = createTextBlock(block);
      root.append(element);
      remember(block.id, element);
      continue;
    }

    const listType = lexicalListType(block.type);
    const item = createListItem(block);
    if (block.parentId === undefined || block.parentId === null) {
      if (
        activeTopList === null ||
        !$isListNode(activeTopList) ||
        activeTopList.getListType() !== listType
      ) {
        activeTopList = $createListNode(listType, block.attributes?.start ?? 1);
        root.append(activeTopList);
      }
      activeTopList.append(item);
    } else {
      const parent = listItems.get(block.parentId);
      if (parent === undefined) {
        throw new Error(
          `List block ${block.id} references missing parent ${block.parentId}`,
        );
      }
      const activeChildList = activeChildLists.get(block.parentId);
      let childList: ListNode;
      if (activeChildList !== undefined && activeChildList.type === listType) {
        childList = activeChildList.node;
      } else {
        childList = $createListNode(listType, block.attributes?.start ?? 1);
        parent.append(childList);
        activeChildLists.set(block.parentId, {
          type: listType,
          node: childList,
        });
      }
      childList.append(item);
    }
    listItems.set(block.id, item);
    remember(block.id, item);
  }

  if (root.getChildrenSize() === 0) {
    const paragraph = $createParagraphNode();
    root.append(paragraph);
  }

  return { blockIdToNodeKey, nodeKeyToBlockId };
};
