import {
  type ApplyRichTextEventsResult,
  type BlockAnchor,
  type BlockDocument,
  type BlockReplica,
  type LinkAttributes,
  type MarkSpan,
  type RichTextEventBatch,
} from "@softmaple/block-model";
import { $isListItemNode } from "@lexical/list";
import {
  $getNodeByKey,
  COLLABORATION_TAG,
  type LexicalEditor,
  type NodeKey,
} from "lexical";
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
import type {
  ProjectedBlock,
  ProjectedBlockAttributes,
  ProjectedBlockType,
  ProjectedDocument,
  ProjectedMark,
} from "./projection-types";

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

interface NumberedListBoundary {
  readonly blockId: string;
  readonly attributes: ProjectedBlockAttributes;
  readonly displayValue: number;
}

interface NumberedListState {
  readonly boundaries: ReadonlyMap<string, NumberedListBoundary>;
  readonly fallbackBoundaries: ReadonlyMap<string, NumberedListBoundary>;
  readonly displayValues: ReadonlyMap<string, number>;
}

interface NumberedListContext {
  readonly activeType: ProjectedBlockType;
  readonly start: number;
  readonly nextValue: number;
  readonly overridden: boolean;
  readonly boundary?: NumberedListBoundary;
}

const EMPTY_NUMBERED_LIST_STATE: NumberedListState = {
  boundaries: new Map(),
  fallbackBoundaries: new Map(),
  displayValues: new Map(),
};

const numberedAttributes = (
  start: number | null | undefined,
  value: number | null | undefined,
): ProjectedBlockAttributes => ({
  ...(start == null ? {} : { start }),
  ...(value == null ? {} : { value }),
});

const createNumberedListState = (
  document: BlockDocument,
): NumberedListState => {
  const boundaries = new Map<string, NumberedListBoundary>();
  const fallbackBoundaries = new Map<string, NumberedListBoundary>();
  const displayValues = new Map<string, number>();
  const contexts = new Map<string | null, NumberedListContext>();

  for (const block of document.blocks) {
    const parentId = block.attrs.parentId;
    const previous = contexts.get(parentId);
    if (block.type !== "number-list") {
      contexts.set(parentId, {
        activeType: block.type,
        start: 1,
        nextValue: 1,
        overridden: false,
      });
      continue;
    }

    const attributes = numberedAttributes(block.attrs.start, block.attrs.value);
    const continuesList = previous?.activeType === "number-list";
    const expectedStart = continuesList
      ? previous.start
      : (attributes.start ?? 1);
    const expectedValue = continuesList ? previous.nextValue : expectedStart;
    const isBoundary =
      (attributes.start !== undefined && attributes.start !== expectedStart) ||
      (attributes.value !== undefined && attributes.value !== expectedValue);
    const start = isBoundary
      ? (attributes.start ?? expectedStart)
      : expectedStart;
    const displayValue = isBoundary
      ? (attributes.value ?? attributes.start ?? expectedValue)
      : expectedValue;
    const boundary = isBoundary
      ? { blockId: block.id, attributes, displayValue }
      : previous?.boundary;

    if (boundary !== undefined) {
      if (isBoundary) boundaries.set(block.id, boundary);
      else fallbackBoundaries.set(block.id, boundary);
    }
    displayValues.set(block.id, displayValue);
    contexts.set(parentId, {
      activeType: "number-list",
      start,
      nextValue: displayValue + 1,
      overridden: isBoundary || (previous?.overridden ?? false),
      ...(boundary === undefined ? {} : { boundary }),
    });
  }

  return { boundaries, fallbackBoundaries, displayValues };
};

const normalizeNumberedListProjection = (
  projection: ProjectedDocument,
  state: NumberedListState,
): ProjectedDocument => {
  const contexts = new Map<NodeKey | null, NumberedListContext>();
  const stableIds = new Set(
    projection.blocks.flatMap((block) =>
      block.stableId === undefined ? [] : [block.stableId],
    ),
  );
  const appliedBoundaries = new Set<string>();
  const blocks = projection.blocks.map((block) => {
    const parentKey = block.parentSourceKey ?? null;
    const previous = contexts.get(parentKey);
    if (block.type !== "number-list") {
      contexts.set(parentKey, {
        activeType: block.type,
        start: 1,
        nextValue: 1,
        overridden: false,
      });
      return block;
    }

    const continuesList = previous?.activeType === "number-list";
    const rawStart = block.attributes.start ?? 1;
    const start = continuesList ? previous.start : rawStart;
    const expectedValue = continuesList ? previous.nextValue : rawStart;
    const directBoundary =
      block.stableId === undefined
        ? undefined
        : state.boundaries.get(block.stableId);
    const fallbackBoundary =
      block.stableId === undefined
        ? undefined
        : state.fallbackBoundaries.get(block.stableId);
    const candidate =
      directBoundary ??
      (fallbackBoundary !== undefined &&
      !stableIds.has(fallbackBoundary.blockId)
        ? fallbackBoundary
        : undefined);
    const boundary =
      candidate !== undefined && !appliedBoundaries.has(candidate.blockId)
        ? candidate
        : undefined;
    if (boundary !== undefined) appliedBoundaries.add(boundary.blockId);
    const overridden =
      boundary !== undefined || (previous?.overridden ?? false);
    const displayValue =
      boundary?.displayValue ??
      (overridden ? expectedValue : (block.attributes.value ?? expectedValue));
    const segmentStart = boundary?.attributes.start ?? start;
    const attributes =
      boundary?.attributes ??
      (overridden
        ? { start: segmentStart, value: displayValue }
        : block.attributes);

    contexts.set(parentKey, {
      activeType: "number-list",
      start: segmentStart,
      nextValue: displayValue + 1,
      overridden,
    });
    return attributes === block.attributes ? block : { ...block, attributes };
  });
  return { blocks };
};

const restoreNumberedListValues = (
  blockIndex: LexicalBlockIndex,
  state: NumberedListState,
): void => {
  for (const [blockId, value] of state.displayValues) {
    const nodeKey = blockIndex.blockIdToNodeKey.get(blockId);
    if (nodeKey === undefined) continue;
    const item = $getNodeByKey(nodeKey);
    if ($isListItemNode(item) && item.getValue() !== value) {
      item.setValue(value);
    }
  }
};

const normalizeBatches = (
  input: RichTextEventBatch | ReadonlyArray<RichTextEventBatch>,
): ReadonlyArray<RichTextEventBatch> =>
  Array.isArray(input) ? input : [input as RichTextEventBatch];

const compareLogicalPoints = (
  left: LogicalSelection["anchor"],
  right: LogicalSelection["anchor"],
  document: BlockDocument,
): number | null => {
  if (left.blockId === right.blockId) return left.offset - right.offset;
  const leftIndex = document.blocks.findIndex(({ id }) => id === left.blockId);
  const rightIndex = document.blocks.findIndex(
    ({ id }) => id === right.blockId,
  );
  if (leftIndex === -1 || rightIndex === -1) return null;
  return leftIndex - rightIndex;
};

const stableSelection = (
  logical: LogicalSelection,
  replica: BlockReplica,
): StableBlockSelection | null => {
  const document = replica.getDocument();
  const blockIds = new Set(document.blocks.map(({ id }) => id));
  if (
    !blockIds.has(logical.anchor.blockId) ||
    !blockIds.has(logical.focus.blockId)
  ) {
    return null;
  }
  const order = compareLogicalPoints(logical.anchor, logical.focus, document);
  if (order === null) return null;
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

const sameLinkValue = (
  left: ProjectedMark["value"],
  right: LinkAttributes,
): boolean => {
  if (left === undefined) return false;
  return (
    left.url === right.url &&
    (left.target ?? null) === (right.target ?? null) &&
    (left.rel ?? null) === (right.rel ?? null) &&
    (left.title ?? null) === (right.title ?? null)
  );
};

const sameProjectedMark = (left: ProjectedMark, right: MarkSpan): boolean => {
  if (
    left.kind !== right.kind ||
    left.from !== right.from ||
    left.to !== right.to
  ) {
    return false;
  }
  if (left.kind === "link") {
    return (
      right.kind === "link" &&
      right.value !== true &&
      sameLinkValue(left.value, right.value)
    );
  }
  return right.value === true;
};

const sameProjectedMarks = (
  left: ReadonlyArray<ProjectedMark>,
  right: ReadonlyArray<MarkSpan>,
): boolean =>
  left.length === right.length &&
  left.every((mark, index) => sameProjectedMark(mark, right[index]!));

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
        sameProjectedMarks(projected.marks, block.marks)
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

const blockIndexForProjection = (
  blocks: ReadonlyArray<ProjectedBlock>,
  blockIds: ReadonlyArray<string>,
): LexicalBlockIndex => {
  const nodeKeyToBlockId = pairProjectedKeysWithBlockIds(blocks, blockIds);
  return {
    blockIdToNodeKey: new Map(
      [...nodeKeyToBlockId].map(([key, id]) => [id, key] as const),
    ),
    nodeKeyToBlockId,
  };
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
  const restoreReadOnlyOnDestroy = enableEditingOnReady && !editor.isEditable();
  let destroyed = false;
  let isComposing = false;
  let isApplyingRemote = false;
  let hasPendingCompositionUpdate = false;
  let hasPendingRemoteMaterialize = false;
  let blockIndex = EMPTY_BLOCK_INDEX;
  let numberedListState = EMPTY_NUMBERED_LIST_STATE;
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
    if (logical === null) return null;
    return stableSelection(logical, replica);
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
    const document = replica.getDocument();
    numberedListState = createNumberedListState(document);
    const logical =
      selection === null ? null : resolveStableSelection(selection, replica);
    isApplyingRemote = true;
    try {
      editor.update(
        () => {
          blockIndex = materializeLexicalDocument(
            toMaterializedDocument(document),
          );
          if (logical !== null) restoreLogicalSelection(logical, blockIndex);
        },
        { discrete: true, tag: COLLABORATION_TAG },
      );
      if (numberedListState.displayValues.size > 0) {
        editor.update(
          () => {
            restoreNumberedListValues(blockIndex, numberedListState);
          },
          {
            discrete: true,
            skipTransforms: true,
            tag: COLLABORATION_TAG,
          },
        );
      }
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
    const reconciled = reconcileReplacementBlockIds(rawProjection, document);
    const projected = normalizeNumberedListProjection(
      reconciled,
      numberedListState,
    );
    if (projectionMatchesDocument(projected, document)) {
      blockIndex = blockIndexForProjection(
        projected.blocks,
        document.blocks.map(({ id }) => id),
      );
      if (numberedListState.displayValues.size > 0) {
        editor.update(
          () => {
            restoreNumberedListValues(blockIndex, numberedListState);
          },
          {
            discrete: true,
            skipTransforms: true,
            tag: COLLABORATION_TAG,
          },
        );
      }
      publishSelection();
      return;
    }
    replica.transact((transaction) => {
      const blockIds = transaction.replaceDocument(
        toBlockDocumentInput(projected),
      );
      blockIndex = blockIndexForProjection(projected.blocks, blockIds);
    });
    numberedListState = createNumberedListState(replica.getDocument());
    if (numberedListState.displayValues.size > 0) {
      editor.update(
        () => {
          restoreNumberedListValues(blockIndex, numberedListState);
        },
        {
          discrete: true,
          skipTransforms: true,
          tag: COLLABORATION_TAG,
        },
      );
    }
    publishSelection();
  };

  try {
    materialize(null);
  } catch (error) {
    reportError(error);
  }
  if (enableEditingOnReady) editor.setEditable(true);

  const unregisterUpdate = editor.registerUpdateListener(
    ({ dirtyElements, dirtyLeaves, tags }) => {
      if (destroyed || isApplyingRemote || tags.has(COLLABORATION_TAG)) return;
      const contentChanged = dirtyElements.size > 0 || dirtyLeaves.size > 0;
      if (isComposing) {
        hasPendingCompositionUpdate ||= contentChanged;
        if (!hasPendingCompositionUpdate) {
          try {
            publishSelection();
          } catch (error) {
            reportError(error);
          }
        }
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
      if (hasPendingRemoteMaterialize) {
        hasPendingRemoteMaterialize = false;
        materialize();
        publishSelection();
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
    if (currentRoot !== null && currentRoot !== nextRoot && isComposing) {
      flushComposition();
    }
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
    if (isComposing) {
      hasPendingRemoteMaterialize = true;
      return;
    }
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
      if (restoreReadOnlyOnDestroy) editor.setEditable(false);
    },
  };
};
