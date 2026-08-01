import {
  type ApplyRichTextEventsResult,
  type BlockAnchor,
  type BlockDocument,
  type BlockReplica,
  type RichTextEventBatch,
} from "@softmaple/block-model";
import { COLLABORATION_TAG, type LexicalEditor, type NodeKey } from "lexical";
import {
  pairProjectedKeysWithBlockIds,
  toBlockDocumentInput,
  toMaterializedDocument,
} from "./block-model-projection";
import {
  captureLogicalSelection,
  restoreLogicalSelection,
  type LogicalSelection,
} from "./lexical-selection";
import { projectLexicalDocument } from "./lexical-to-projection";
import {
  materializeLexicalDocument,
  type LexicalBlockIndex,
} from "./projection-to-lexical";
import type { ProjectedBlock, ProjectedDocument } from "./projection-types";

export interface StableBlockSelection {
  readonly anchor: BlockAnchor;
  readonly focus: BlockAnchor;
}

export interface LexicalBindingOptions {
  readonly editor: LexicalEditor;
  readonly replica: BlockReplica;
  readonly enableEditingOnReady?: boolean;
  readonly onError?: (error: Error) => void;
  readonly onSelectionChange?: (selection: StableBlockSelection | null) => void;
}

export interface LexicalBinding {
  readonly editor: LexicalEditor;
  readonly replica: BlockReplica;
  applyRemoteEvents(
    batches: RichTextEventBatch | ReadonlyArray<RichTextEventBatch>,
  ): ApplyRichTextEventsResult | null;
  captureSelection(): StableBlockSelection | null;
  resolveSelection(selection: StableBlockSelection): LogicalSelection;
  getBlockIndex(): LexicalBlockIndex;
  destroy(): void;
}

const EMPTY_BLOCK_INDEX: LexicalBlockIndex = {
  blockIdToNodeKey: new Map(),
  nodeKeyToBlockId: new Map(),
};

const normalizeBatches = (
  input: RichTextEventBatch | ReadonlyArray<RichTextEventBatch>,
): ReadonlyArray<RichTextEventBatch> =>
  Array.isArray(input) ? input : [input as RichTextEventBatch];

const compareLogicalPoints = (
  left: LogicalSelection["anchor"],
  right: LogicalSelection["anchor"],
  document: BlockDocument,
): number => {
  if (left.blockId === right.blockId) return left.offset - right.offset;
  const leftIndex = document.blocks.findIndex(({ id }) => id === left.blockId);
  const rightIndex = document.blocks.findIndex(
    ({ id }) => id === right.blockId,
  );
  return leftIndex - rightIndex;
};

const stableSelection = (
  logical: LogicalSelection,
  replica: BlockReplica,
): StableBlockSelection => {
  const order = compareLogicalPoints(
    logical.anchor,
    logical.focus,
    replica.getDocument(),
  );
  const collapsed = order === 0;
  const anchorAffinity = collapsed ? "after" : order < 0 ? "after" : "before";
  const focusAffinity = collapsed ? "after" : order < 0 ? "before" : "after";
  return {
    anchor: replica.captureBlockAnchor(
      logical.anchor.blockId,
      logical.anchor.offset,
      anchorAffinity,
    ),
    focus: replica.captureBlockAnchor(
      logical.focus.blockId,
      logical.focus.offset,
      focusAffinity,
    ),
  };
};

const resolveStableSelection = (
  selection: StableBlockSelection,
  replica: BlockReplica,
): LogicalSelection => ({
  anchor: replica.resolveBlockAnchor(selection.anchor),
  focus: replica.resolveBlockAnchor(selection.focus),
});

const sameJson = (left: unknown, right: unknown): boolean =>
  JSON.stringify(left) === JSON.stringify(right);

const expectedParentId = (
  block: ProjectedBlock,
  stableIds: ReadonlyMap<NodeKey, string>,
): string | null =>
  block.parentSourceKey === undefined
    ? null
    : (stableIds.get(block.parentSourceKey) ?? null);

const projectionMatchesDocument = (
  projection: ProjectedDocument,
  document: BlockDocument,
): boolean => {
  const stableIds = new Map<NodeKey, string>();
  for (const block of projection.blocks) {
    if (block.stableId !== undefined) {
      stableIds.set(block.sourceKey, block.stableId);
    }
  }
  return (
    projection.blocks.length === document.blocks.length &&
    projection.blocks.every((projected, index) => {
      const block = document.blocks[index];
      if (
        block === undefined ||
        projected.stableId !== block.id ||
        projected.type !== block.type ||
        projected.text !== block.text ||
        expectedParentId(projected, stableIds) !== block.attrs.parentId
      ) {
        return false;
      }
      const attributes = projected.attributes;
      return (
        (attributes.language ?? null) === block.attrs.language &&
        (attributes.theme ?? null) === block.attrs.theme &&
        (attributes.start ?? null) === block.attrs.start &&
        (attributes.value ?? null) === block.attrs.value &&
        (attributes.checked ?? null) === block.attrs.checked &&
        sameJson(
          projected.marks.map((mark) => ({
            ...mark,
            value: mark.kind === "link" ? mark.value : true,
          })),
          block.marks,
        )
      );
    })
  );
};

interface ProjectionAnchor {
  readonly projectedIndex: number;
  readonly documentIndex: number;
}

const reconcileReplacementBlockIds = (
  projection: ProjectedDocument,
  document: BlockDocument,
): ProjectedDocument => {
  const documentIndexById = new Map(
    document.blocks.map((block, index) => [block.id, index]),
  );
  const anchors: ProjectionAnchor[] = [];
  for (const [projectedIndex, block] of projection.blocks.entries()) {
    if (block.stableId === undefined) continue;
    const documentIndex = documentIndexById.get(block.stableId);
    if (documentIndex === undefined) return projection;
    anchors.push({ projectedIndex, documentIndex });
  }
  if (
    anchors.some(
      (anchor, index) =>
        index > 0 &&
        anchor.documentIndex <= (anchors[index - 1]?.documentIndex ?? -1),
    )
  ) {
    return projection;
  }

  const boundaries: ReadonlyArray<ProjectionAnchor> = [
    { projectedIndex: -1, documentIndex: -1 },
    ...anchors,
    {
      projectedIndex: projection.blocks.length,
      documentIndex: document.blocks.length,
    },
  ];
  const blocks = [...projection.blocks];
  for (let index = 0; index < boundaries.length - 1; index++) {
    const left = boundaries[index];
    const right = boundaries[index + 1];
    if (left === undefined || right === undefined) continue;
    const projectedCount = right.projectedIndex - left.projectedIndex - 1;
    const documentCount = right.documentIndex - left.documentIndex - 1;
    if (projectedCount !== documentCount) continue;

    for (let offset = 1; offset <= projectedCount; offset++) {
      const projectedIndex = left.projectedIndex + offset;
      const documentIndex = left.documentIndex + offset;
      const block = blocks[projectedIndex];
      const stableId = document.blocks[documentIndex]?.id;
      if (block !== undefined && stableId !== undefined) {
        blocks[projectedIndex] = { ...block, stableId };
      }
    }
  }
  return { blocks };
};

export const createLexicalBinding = ({
  editor,
  replica,
  enableEditingOnReady = true,
  onError = (error) => {
    throw error;
  },
  onSelectionChange,
}: LexicalBindingOptions): LexicalBinding => {
  let destroyed = false;
  let isComposing = false;
  let isApplyingRemote = false;
  let hasPendingCompositionUpdate = false;
  let blockIndex = EMPTY_BLOCK_INDEX;
  let queuedRemoteBatches: RichTextEventBatch[] = [];
  let pendingSelection: StableBlockSelection | null = null;
  let previousSelectionJson = "";

  const reportError = (error: unknown): void => {
    onError(error instanceof Error ? error : new Error(String(error)));
  };

  const captureSelection = (): StableBlockSelection | null => {
    let logical: LogicalSelection | null = null;
    editor.getEditorState().read(() => {
      logical = captureLogicalSelection(blockIndex);
    });
    return logical === null ? null : stableSelection(logical, replica);
  };

  const publishSelection = (): void => {
    if (onSelectionChange === undefined || destroyed) return;
    const selection = captureSelection();
    const serialized = JSON.stringify(selection);
    if (serialized === previousSelectionJson) return;
    previousSelectionJson = serialized;
    onSelectionChange(selection);
  };

  const materialize = (
    selection: StableBlockSelection | null = pendingSelection,
  ): void => {
    if (destroyed) return;
    const logical =
      selection === null ? null : resolveStableSelection(selection, replica);
    isApplyingRemote = true;
    try {
      editor.update(
        () => {
          blockIndex = materializeLexicalDocument(
            toMaterializedDocument(replica.getDocument()),
          );
          if (logical !== null) restoreLogicalSelection(logical, blockIndex);
        },
        { discrete: true, tag: COLLABORATION_TAG },
      );
    } finally {
      isApplyingRemote = false;
      pendingSelection = null;
    }
  };

  const commitEditorState = (): void => {
    if (destroyed || isApplyingRemote) return;
    const document = replica.getDocument();
    const rawProjection = editor
      .getEditorState()
      .read(() => projectLexicalDocument(blockIndex.nodeKeyToBlockId));
    const projected = reconcileReplacementBlockIds(rawProjection, document);
    if (projectionMatchesDocument(projected, document)) {
      publishSelection();
      return;
    }
    replica.transact((transaction) => {
      const blockIds = transaction.replaceDocument(
        toBlockDocumentInput(projected),
      );
      blockIndex = {
        blockIdToNodeKey: new Map(
          [...pairProjectedKeysWithBlockIds(projected.blocks, blockIds)].map(
            ([key, id]) => [id, key] as const,
          ),
        ),
        nodeKeyToBlockId: pairProjectedKeysWithBlockIds(
          projected.blocks,
          blockIds,
        ),
      };
    });
    publishSelection();
  };

  materialize(null);
  if (enableEditingOnReady) editor.setEditable(true);

  const unregisterUpdate = editor.registerUpdateListener(
    ({ dirtyElements, dirtyLeaves, tags }) => {
      if (destroyed || isApplyingRemote || tags.has(COLLABORATION_TAG)) return;
      const contentChanged = dirtyElements.size > 0 || dirtyLeaves.size > 0;
      if (isComposing) {
        hasPendingCompositionUpdate ||= contentChanged;
        publishSelection();
        return;
      }
      try {
        if (contentChanged) commitEditorState();
        else publishSelection();
      } catch (error) {
        reportError(error);
      }
    },
  );

  const flushComposition = (): void => {
    if (destroyed) return;
    isComposing = false;
    try {
      if (hasPendingCompositionUpdate) commitEditorState();
      hasPendingCompositionUpdate = false;
      if (queuedRemoteBatches.length > 0) {
        pendingSelection = captureSelection();
        const queued = queuedRemoteBatches;
        queuedRemoteBatches = [];
        replica.applyRemoteEvents(queued);
      }
    } catch (error) {
      reportError(error);
    }
  };

  let currentRoot: HTMLElement | null = null;
  const handleCompositionStart = (): void => {
    isComposing = true;
  };
  const handleCompositionEnd = (): void => {
    queueMicrotask(flushComposition);
  };
  const unregisterRoot = editor.registerRootListener((nextRoot) => {
    currentRoot?.removeEventListener(
      "compositionstart",
      handleCompositionStart,
    );
    currentRoot?.removeEventListener("compositionend", handleCompositionEnd);
    currentRoot = nextRoot;
    currentRoot?.addEventListener("compositionstart", handleCompositionStart);
    currentRoot?.addEventListener("compositionend", handleCompositionEnd);
  });

  const unsubscribeReplica = replica.subscribe((change) => {
    if (destroyed || change.origin !== "remote") return;
    if (isComposing) return;
    try {
      materialize();
      publishSelection();
    } catch (error) {
      reportError(error);
    }
  });

  return {
    editor,
    replica,
    applyRemoteEvents: (input) => {
      const batches = normalizeBatches(input);
      if (isComposing) {
        queuedRemoteBatches.push(...batches);
        return null;
      }
      pendingSelection = captureSelection();
      return replica.applyRemoteEvents(batches);
    },
    captureSelection,
    resolveSelection: (selection) => resolveStableSelection(selection, replica),
    getBlockIndex: () => blockIndex,
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      currentRoot?.removeEventListener(
        "compositionstart",
        handleCompositionStart,
      );
      currentRoot?.removeEventListener("compositionend", handleCompositionEnd);
      currentRoot = null;
      queuedRemoteBatches = [];
      unsubscribeReplica();
      unregisterRoot();
      unregisterUpdate();
    },
  };
};
