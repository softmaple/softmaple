import { HeadingNode, QuoteNode } from "@lexical/rich-text";
import { ListItemNode, ListNode } from "@lexical/list";
import type { Klass, LexicalNode } from "lexical";
import { LinkNode } from "@lexical/link";
// import { CodeNode } from "@lexical/code";

export const PlaygroundNodes: Array<Klass<LexicalNode>> = [
  HeadingNode,
  ListNode,
  ListItemNode,
  QuoteNode,

  LinkNode,
];
