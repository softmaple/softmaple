import type { SequenceAnchor } from "@softmaple/eg-walker/anchors";

import type { BLOCK_MODEL_SCHEMA_VERSION } from "./constants";

export type BlockId = string;

export type BlockType =
  | "paragraph"
  | "h1"
  | "h2"
  | "h3"
  | "quote"
  | "code"
  | "bullet-list"
  | "number-list"
  | "check-list";

export type MarkKind =
  | "bold"
  | "italic"
  | "underline"
  | "strike"
  | "inline-code"
  | "link";

export interface LinkAttributes {
  readonly url: string;
  readonly target?: string;
  readonly rel?: string;
  readonly title?: string;
}

export interface BlockAttributes {
  readonly parentId: BlockId | null;
  readonly language: string | null;
  readonly theme: string | null;
  readonly start: number | null;
  readonly value: number | null;
  readonly checked: boolean | null;
}

export interface BlockAttributePatch {
  readonly parentId?: BlockId | null;
  readonly language?: string | null;
  readonly theme?: string | null;
  readonly start?: number | null;
  readonly value?: number | null;
  readonly checked?: boolean | null;
}

export interface BlockFieldPatch extends BlockAttributePatch {
  readonly type?: BlockType;
}

export interface MarkSpan {
  readonly kind: MarkKind;
  readonly from: number;
  readonly to: number;
  readonly value: true | LinkAttributes;
}

export interface Block {
  readonly id: BlockId;
  readonly type: BlockType;
  readonly text: string;
  readonly attrs: BlockAttributes;
  readonly marks: ReadonlyArray<MarkSpan>;
}

export interface BlockDocument {
  readonly schemaVersion: typeof BLOCK_MODEL_SCHEMA_VERSION;
  readonly blocks: ReadonlyArray<Block>;
}

export interface BlockInput {
  /** Existing stable ID. Omit for a newly projected editor block. */
  readonly id?: BlockId;
  /** Transaction-local name usable from `parentInputId`. */
  readonly inputId?: string;
  readonly parentInputId?: string | null;
  readonly type: BlockType;
  readonly text: string;
  readonly attrs?: BlockAttributePatch;
  readonly marks?: ReadonlyArray<MarkSpan>;
}

export interface BlockDocumentInput {
  readonly blocks: ReadonlyArray<BlockInput>;
}

export interface BlockAnchor {
  readonly blockId: BlockId;
  readonly anchor: SequenceAnchor;
}

export interface ResolvedBlockAnchor {
  readonly blockId: BlockId;
  readonly offset: number;
}

export interface MarkBoundaryAffinity {
  readonly start: "before" | "after";
  readonly end: "before" | "after";
}

export type SerializedTextOperation =
  | { readonly type: "insert"; readonly index: number; readonly text: string }
  | {
      readonly type: "delete";
      readonly index: number;
      readonly length: number;
    };

export interface CompleteBlockFields extends BlockAttributes {
  readonly type: BlockType;
}

export type RichTextEffect =
  | {
      readonly type: "bootstrap";
      readonly blockId: BlockId;
      readonly fields: CompleteBlockFields;
    }
  | {
      readonly type: "block-create";
      readonly blockId: BlockId;
      readonly sourceBlockId: BlockId | null;
      readonly fields: CompleteBlockFields;
    }
  | {
      readonly type: "text-insert";
      readonly blockId: BlockId;
      readonly text: string;
    }
  | {
      readonly type: "text-delete";
      readonly blockId: BlockId;
    }
  | {
      readonly type: "block-set";
      readonly blockId: BlockId;
      readonly fields: BlockFieldPatch;
    }
  | { readonly type: "block-join"; readonly blockId: BlockId }
  | { readonly type: "block-delete"; readonly blockId: BlockId }
  | {
      readonly type: "mark-set";
      readonly kind: MarkKind;
      readonly value: true | LinkAttributes | null;
      readonly range: {
        readonly start: SequenceAnchor;
        readonly end: SequenceAnchor;
      };
    };

export interface RichTextEvent {
  readonly schemaVersion: typeof BLOCK_MODEL_SCHEMA_VERSION;
  readonly id: string;
  readonly parentVersion: ReadonlyArray<string>;
  readonly timestamp: number;
  readonly operation: SerializedTextOperation;
  readonly effect: RichTextEffect;
}

export interface RichTextEventBatch {
  readonly schemaVersion: typeof BLOCK_MODEL_SCHEMA_VERSION;
  readonly batchId: string;
  readonly parentVersion: ReadonlyArray<string>;
  readonly events: ReadonlyArray<RichTextEvent>;
}

export interface SerializedBlockReplica {
  readonly schemaVersion: typeof BLOCK_MODEL_SCHEMA_VERSION;
  readonly batches: ReadonlyArray<RichTextEventBatch>;
}

export type BlockReplicaOrigin = "local" | "remote";

export interface BlockReplicaChange {
  readonly origin: BlockReplicaOrigin;
  readonly batchIds: ReadonlyArray<string>;
  readonly document: BlockDocument;
}

export type BlockReplicaListener = (change: BlockReplicaChange) => void;

export interface ApplyRichTextEventsResult {
  readonly integratedBatchIds: ReadonlyArray<string>;
  readonly pendingBatchIds: ReadonlyArray<string>;
}

export interface BlockTransaction {
  insertText(blockId: BlockId, offset: number, text: string): void;
  deleteText(blockId: BlockId, from: number, to: number): void;
  insertBlock(afterBlockId: BlockId | null, block: BlockInput): BlockId;
  splitBlock(
    blockId: BlockId,
    offset: number,
    fields?: BlockFieldPatch,
    preferredBlockId?: BlockId,
  ): BlockId;
  joinBlock(blockId: BlockId): void;
  deleteBlock(blockId: BlockId): void;
  setBlock(blockId: BlockId, fields: BlockFieldPatch): void;
  setMark(
    blockId: BlockId,
    from: number,
    to: number,
    kind: MarkKind,
    value: true | LinkAttributes | null,
    affinity?: MarkBoundaryAffinity,
  ): void;
  replaceDocument(next: BlockDocumentInput): ReadonlyArray<BlockId>;
}
