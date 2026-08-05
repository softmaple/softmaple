import { $isCodeNode } from "@lexical/code";
import { $isLinkNode, type LinkNode } from "@lexical/link";
import {
  $isListItemNode,
  $isListNode,
  type ListItemNode,
  type ListNode,
  type ListType,
} from "@lexical/list";
import {
  $isHeadingNode,
  $isQuoteNode,
  type HeadingNode,
} from "@lexical/rich-text";
import {
  $getRoot,
  $isElementNode,
  $isLineBreakNode,
  $isParagraphNode,
  $isTabNode,
  $isTextNode,
  IS_BOLD,
  IS_CODE,
  IS_ITALIC,
  IS_STRIKETHROUGH,
  IS_UNDERLINE,
  type ElementNode,
  type LexicalNode,
  type NodeKey,
  type TextNode,
} from "lexical";
import { UnsupportedLexicalNodeError } from "./errors";
import type {
  ProjectedBlock,
  ProjectedBlockAttributes,
  ProjectedBlockType,
  ProjectedDocument,
  ProjectedLinkValue,
  ProjectedMark,
  ProjectedMarkKind,
} from "./projection-types";

const SUPPORTED_TEXT_FORMAT =
  IS_BOLD | IS_ITALIC | IS_UNDERLINE | IS_STRIKETHROUGH | IS_CODE;

const MARK_ORDER: Readonly<Record<ProjectedMarkKind, number>> = {
  bold: 0,
  italic: 1,
  underline: 2,
  strike: 3,
  "inline-code": 4,
  link: 5,
};

interface InlineAccumulator {
  text: string;
  marks: ProjectedMark[];
}

const sameLinkValue = (
  left: ProjectedLinkValue | undefined,
  right: ProjectedLinkValue | undefined,
): boolean =>
  left === undefined || right === undefined
    ? left === right
    : left.url === right.url &&
      left.target === right.target &&
      left.rel === right.rel &&
      left.title === right.title;

const compareMarkKinds = (
  left: ProjectedMarkKind,
  right: ProjectedMarkKind,
): number => (left < right ? -1 : left > right ? 1 : 0);

const isUnmarkableInlineGap = (
  text: string,
  from: number,
  to: number,
): boolean =>
  from < to &&
  Array.from(text.slice(from, to)).every((character) => character === "\n");

const normalizeMarks = (
  marks: ReadonlyArray<ProjectedMark>,
  text: string,
): ReadonlyArray<ProjectedMark> => {
  const sorted = [...marks].sort(
    (left, right) =>
      MARK_ORDER[left.kind] - MARK_ORDER[right.kind] ||
      left.from - right.from ||
      left.to - right.to,
  );
  const normalized: ProjectedMark[] = [];
  for (const mark of sorted) {
    if (mark.from >= mark.to) continue;
    const previous = normalized.at(-1);
    if (
      previous !== undefined &&
      previous.kind === mark.kind &&
      (previous.to >= mark.from ||
        isUnmarkableInlineGap(text, previous.to, mark.from)) &&
      sameLinkValue(previous.value, mark.value)
    ) {
      normalized[normalized.length - 1] = {
        ...previous,
        to: Math.max(previous.to, mark.to),
      };
      continue;
    }
    normalized.push(mark);
  }
  return normalized.sort(
    (left, right) =>
      left.from - right.from ||
      left.to - right.to ||
      compareMarkKinds(left.kind, right.kind),
  );
};

const linkValue = (node: LinkNode): ProjectedLinkValue => {
  const target = node.getTarget();
  const rel = node.getRel();
  const title = node.getTitle();
  return {
    url: node.getURL(),
    ...(target == null ? {} : { target }),
    ...(rel == null ? {} : { rel }),
    ...(title == null ? {} : { title }),
  };
};

const appendTextNode = (
  accumulator: InlineAccumulator,
  node: TextNode,
  activeLink: ProjectedLinkValue | undefined,
): void => {
  if (node.getMode() !== "normal") {
    throw new UnsupportedLexicalNodeError(
      node.getType(),
      `text mode ${node.getMode()} is not collaborative`,
    );
  }
  if (node.getStyle() !== "") {
    throw new UnsupportedLexicalNodeError(
      node.getType(),
      "arbitrary inline CSS is not collaborative",
    );
  }
  if ((node.getFormat() & ~SUPPORTED_TEXT_FORMAT) !== 0) {
    throw new UnsupportedLexicalNodeError(
      node.getType(),
      "highlight, subscript, superscript, and case transforms are not supported",
    );
  }

  const from = accumulator.text.length;
  accumulator.text += node.getTextContent();
  const to = accumulator.text.length;
  const formats: ReadonlyArray<
    readonly [Exclude<ProjectedMarkKind, "link">, boolean]
  > = [
    ["bold", node.hasFormat("bold")],
    ["italic", node.hasFormat("italic")],
    ["underline", node.hasFormat("underline")],
    ["strike", node.hasFormat("strikethrough")],
    ["inline-code", node.hasFormat("code")],
  ];
  for (const [kind, enabled] of formats) {
    if (enabled) accumulator.marks.push({ kind, from, to });
  }
  if (activeLink !== undefined) {
    accumulator.marks.push({ kind: "link", from, to, value: activeLink });
  }
};

const appendInlineNode = (
  accumulator: InlineAccumulator,
  node: LexicalNode,
  activeLink?: ProjectedLinkValue,
): void => {
  if ($isTextNode(node)) {
    appendTextNode(accumulator, node, activeLink);
    return;
  }
  if ($isLineBreakNode(node)) {
    accumulator.text += "\n";
    return;
  }
  if ($isTabNode(node)) {
    accumulator.text += "\t";
    return;
  }
  if ($isLinkNode(node)) {
    if (activeLink !== undefined) {
      throw new UnsupportedLexicalNodeError(
        node.getType(),
        "nested links are invalid",
      );
    }
    const value = linkValue(node);
    for (const child of node.getChildren()) {
      appendInlineNode(accumulator, child, value);
    }
    return;
  }
  throw new UnsupportedLexicalNodeError(node.getType());
};

const projectInlineChildren = (
  children: ReadonlyArray<LexicalNode>,
): Pick<ProjectedBlock, "marks" | "text"> => {
  const accumulator: InlineAccumulator = { text: "", marks: [] };
  for (const child of children) {
    appendInlineNode(accumulator, child);
  }
  return {
    text: accumulator.text,
    marks: normalizeMarks(accumulator.marks, accumulator.text),
  };
};

const headingType = (node: HeadingNode): ProjectedBlockType => {
  const tag = node.getTag();
  if (tag === "h1" || tag === "h2" || tag === "h3") return tag;
  throw new UnsupportedLexicalNodeError(
    node.getType(),
    `${tag.toUpperCase()} is outside the v1 collaboration schema`,
  );
};

const assertNoUnsupportedAlignment = (node: ElementNode): void => {
  const format = node.getFormatType();
  if (format !== "") {
    throw new UnsupportedLexicalNodeError(
      node.getType(),
      `block alignment ${format} is outside the v1 collaboration schema`,
    );
  }
};

const assertNoUnsupportedIndent = (node: ElementNode): void => {
  if (node.getIndent() !== 0) {
    throw new UnsupportedLexicalNodeError(
      node.getType(),
      "arbitrary indentation is not supported; use nested lists",
    );
  }
};

const projectTopLevelBlock = (
  node: ElementNode,
  stableIds: ReadonlyMap<NodeKey, string>,
): ProjectedBlock => {
  assertNoUnsupportedIndent(node);
  assertNoUnsupportedAlignment(node);
  let type: ProjectedBlockType;
  const attributes: ProjectedBlockAttributes = {};
  if ($isParagraphNode(node)) {
    type = "paragraph";
  } else if ($isHeadingNode(node)) {
    type = headingType(node);
  } else if ($isQuoteNode(node)) {
    type = "quote";
  } else if ($isCodeNode(node)) {
    type = "code";
    Object.assign(attributes, {
      language: node.getLanguage(),
      theme: node.getTheme(),
    });
  } else {
    throw new UnsupportedLexicalNodeError(node.getType());
  }
  return {
    sourceKey: node.getKey(),
    stableId: stableIds.get(node.getKey()),
    type,
    ...projectInlineChildren(node.getChildren()),
    attributes,
  };
};

const listBlockType = (listType: ListType): ProjectedBlockType => {
  switch (listType) {
    case "bullet":
      return "bullet-list";
    case "number":
      return "number-list";
    case "check":
      return "check-list";
  }
  throw new UnsupportedLexicalNodeError(
    "list",
    `unknown list type ${listType}`,
  );
};

const projectList = (
  list: ListNode,
  stableIds: ReadonlyMap<NodeKey, string>,
  blocks: ProjectedBlock[],
  parentSourceKey?: NodeKey,
): void => {
  const listType = list.getListType();
  let lastSubstantiveSourceKey = parentSourceKey;
  for (const child of list.getChildren()) {
    if (!$isListItemNode(child)) {
      throw new UnsupportedLexicalNodeError(
        child.getType(),
        "list nodes may only contain list items",
      );
    }
    const nestedLists = child.getChildren().filter($isListNode);
    const inlineChildren = child
      .getChildren()
      .filter((candidate) => !$isListNode(candidate));

    // Lexical represents some nested-list transitions with a wrapper item
    // containing only a ListNode. It is structural and must not receive an ID.
    if (inlineChildren.length === 0 && nestedLists.length > 0) {
      for (const nested of nestedLists) {
        projectList(nested, stableIds, blocks, lastSubstantiveSourceKey);
      }
      continue;
    }

    const block = projectListItem(
      child,
      list,
      listType,
      inlineChildren,
      stableIds,
      parentSourceKey,
    );
    blocks.push(block);
    lastSubstantiveSourceKey = block.sourceKey;
    for (const nested of nestedLists) {
      projectList(nested, stableIds, blocks, block.sourceKey);
    }
  }
};

const projectListItem = (
  item: ListItemNode,
  list: ListNode,
  listType: ListType,
  inlineChildren: ReadonlyArray<LexicalNode>,
  stableIds: ReadonlyMap<NodeKey, string>,
  parentSourceKey?: NodeKey,
): ProjectedBlock => {
  assertNoUnsupportedAlignment(item);
  const attributes: ProjectedBlockAttributes = {};
  if (listType === "number") {
    Object.assign(attributes, {
      start: list.getStart(),
      value: item.getValue(),
    });
  }
  if (listType === "check") {
    const checked = item.getChecked();
    if (checked !== undefined) Object.assign(attributes, { checked });
  }
  return {
    sourceKey: item.getKey(),
    stableId: stableIds.get(item.getKey()),
    parentSourceKey,
    type: listBlockType(listType),
    ...projectInlineChildren(inlineChildren),
    attributes,
  };
};

/** Read the active editor state and produce a strict v1 block projection. */
export const projectLexicalDocument = (
  stableIds: ReadonlyMap<NodeKey, string> = new Map(),
): ProjectedDocument => {
  const blocks: ProjectedBlock[] = [];
  for (const child of $getRoot().getChildren()) {
    if ($isListNode(child)) {
      assertNoUnsupportedIndent(child);
      assertNoUnsupportedAlignment(child);
      projectList(child, stableIds, blocks);
      continue;
    }
    if ($isListItemNode(child)) {
      throw new UnsupportedLexicalNodeError(
        child.getType(),
        "list items must be owned by a list",
      );
    }
    if (!$isElementNode(child)) {
      throw new UnsupportedLexicalNodeError(child.getType());
    }
    blocks.push(projectTopLevelBlock(child, stableIds));
  }
  return { blocks };
};
