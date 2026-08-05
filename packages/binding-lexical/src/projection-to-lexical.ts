import { $createCodeNode } from "@lexical/code";
import { $createLinkNode, type LinkNode } from "@lexical/link";
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
  $getNodeByKey,
  $getRoot,
  $isElementNode,
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

export interface PreviousLexicalMaterialization {
  readonly document: MaterializedDocument;
  readonly index: LexicalBlockIndex;
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
  openLink: LinkNode | null,
): LinkNode | null => {
  for (const [kind, format] of textFormats) {
    if (marks.some((mark) => mark.kind === kind)) {
      textNode.toggleFormat(format);
    }
  }
  const link = marks.find((mark) => mark.kind === "link");
  if (link === undefined) {
    parent.append(textNode);
    return null;
  }
  if (
    openLink !== null &&
    openLink.getURL() === link.value.url &&
    openLink.getTarget() === (link.value.target ?? null) &&
    openLink.getRel() === (link.value.rel ?? null) &&
    openLink.getTitle() === (link.value.title ?? null)
  ) {
    openLink.append(textNode);
    return openLink;
  }
  const linkNode = createLink(link.value);
  linkNode.append(textNode);
  parent.append(linkNode);
  return linkNode;
};

const appendTextRun = (
  parent: ElementNode,
  text: string,
  marks: ReadonlyArray<ProjectedMark>,
  openLink: LinkNode | null,
): LinkNode | null =>
  appendMarkedTextNode(parent, $createTextNode(text), marks, openLink);

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
  let openLink: LinkNode | null = null;
  for (let index = 0; index < ordered.length - 1; index++) {
    const from = ordered[index];
    const to = ordered[index + 1];
    if (from === undefined || to === undefined || from === to) continue;
    const content = text.slice(from, to);
    if (content === "\n") {
      parent.append($createLineBreakNode());
      openLink = null;
      continue;
    }
    if (content === "\t") {
      openLink = appendMarkedTextNode(
        parent,
        $createTabNode(),
        activeMarks(marks, from, to),
        openLink,
      );
      continue;
    }
    openLink = appendTextRun(
      parent,
      content,
      activeMarks(marks, from, to),
      openLink,
    );
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

const sameLinkValue = (
  left: ProjectedLinkValue,
  right: ProjectedLinkValue,
): boolean =>
  left.url === right.url &&
  left.target === right.target &&
  left.rel === right.rel &&
  left.title === right.title;

const sameMarks = (
  left: ReadonlyArray<ProjectedMark>,
  right: ReadonlyArray<ProjectedMark>,
): boolean =>
  left.length === right.length &&
  left.every((mark, index) => {
    const other = right[index];
    if (
      other === undefined ||
      mark.kind !== other.kind ||
      mark.from !== other.from ||
      mark.to !== other.to
    ) {
      return false;
    }
    return mark.kind !== "link" || other.kind !== "link"
      ? mark.kind === other.kind
      : sameLinkValue(mark.value, other.value);
  });

const sameBlock = (
  left: MaterializedBlock,
  right: MaterializedBlock,
): boolean =>
  left.id === right.id &&
  (left.parentId ?? null) === (right.parentId ?? null) &&
  left.type === right.type &&
  left.text === right.text &&
  left.attributes?.checked === right.attributes?.checked &&
  left.attributes?.language === right.attributes?.language &&
  left.attributes?.theme === right.attributes?.theme &&
  left.attributes?.start === right.attributes?.start &&
  left.attributes?.value === right.attributes?.value &&
  sameMarks(left.marks, right.marks);

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
  previous?: PreviousLexicalMaterialization,
): LexicalBlockIndex => {
  const root = $getRoot();
  const previousBlocks = new Map(
    previous?.document.blocks.map((block) => [block.id, block]),
  );
  const reusableNodes = new Map<string, ElementNode>();
  if (previous !== undefined) {
    for (const block of document.blocks) {
      const previousBlock = previousBlocks.get(block.id);
      const key = previous.index.blockIdToNodeKey.get(block.id);
      const node = key === undefined ? null : $getNodeByKey(key);
      if (
        previousBlock !== undefined &&
        sameBlock(block, previousBlock) &&
        $isElementNode(node) &&
        (isListBlock(block.type)
          ? $isListItemNode(node)
          : !$isListItemNode(node))
      ) {
        reusableNodes.set(block.id, node);
      }
    }
  }
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
      const element = reusableNodes.get(block.id) ?? createTextBlock(block);
      root.append(element);
      remember(block.id, element);
      continue;
    }

    const listType = lexicalListType(block.type);
    const reusable = reusableNodes.get(block.id);
    const item = $isListItemNode(reusable) ? reusable : createListItem(block);
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
