import type {
  BlockDocument,
  BlockDocumentInput,
  BlockInput,
  LinkAttributes,
  MarkSpan,
} from "@softmaple/block-model";
import type { NodeKey } from "lexical";
import type { MaterializedDocument } from "./projection-to-lexical";
import type {
  ProjectedBlock,
  ProjectedDocument,
  ProjectedLinkValue,
  ProjectedMark,
} from "./projection-types";

const nullableString = (value: string | null | undefined): string | null =>
  value ?? null;

const nullableNumber = (value: number | null | undefined): number | null =>
  value ?? null;

const linkAttributes = (value: ProjectedLinkValue): LinkAttributes => ({
  url: value.url,
  ...(value.target == null ? {} : { target: value.target }),
  ...(value.rel == null ? {} : { rel: value.rel }),
  ...(value.title == null ? {} : { title: value.title }),
});

const inputMark = (mark: ProjectedMark): MarkSpan => {
  if (mark.kind !== "link") {
    return { kind: mark.kind, from: mark.from, to: mark.to, value: true };
  }
  if (mark.value === undefined) {
    throw new Error("A projected link mark must include link attributes");
  }
  return {
    kind: mark.kind,
    from: mark.from,
    to: mark.to,
    value: linkAttributes(mark.value),
  };
};

const blockInput = (block: ProjectedBlock): BlockInput => ({
  ...(block.stableId === undefined ? {} : { id: block.stableId }),
  inputId: block.sourceKey,
  ...(block.parentSourceKey === undefined
    ? { parentInputId: null }
    : { parentInputId: block.parentSourceKey }),
  type: block.type,
  text: block.text,
  attrs: {
    language: nullableString(block.attributes.language),
    theme: nullableString(block.attributes.theme),
    start: nullableNumber(block.attributes.start),
    value: nullableNumber(block.attributes.value),
    checked: block.attributes.checked ?? null,
  },
  marks: block.marks.map(inputMark),
});

export const toBlockDocumentInput = (
  projection: ProjectedDocument,
): BlockDocumentInput => ({
  blocks: projection.blocks.map(blockInput),
});

export const toMaterializedDocument = (
  document: BlockDocument,
): MaterializedDocument => ({
  blocks: document.blocks.map((block) => ({
    id: block.id,
    parentId: block.attrs.parentId,
    type: block.type,
    text: block.text,
    marks: block.marks.map((mark) => ({
      kind: mark.kind,
      from: mark.from,
      to: mark.to,
      ...(mark.kind === "link" && mark.value !== true
        ? { value: mark.value }
        : {}),
    })),
    attributes: {
      checked: block.attrs.checked ?? undefined,
      language: block.attrs.language,
      theme: block.attrs.theme,
      start: block.attrs.start ?? undefined,
      value: block.attrs.value ?? undefined,
    },
  })),
});

export const pairProjectedKeysWithBlockIds = (
  blocks: ReadonlyArray<ProjectedBlock>,
  blockIds: ReadonlyArray<string>,
): ReadonlyMap<NodeKey, string> => {
  if (blocks.length !== blockIds.length) {
    throw new Error(
      `Block model returned ${blockIds.length} IDs for ${blocks.length} projected blocks`,
    );
  }
  return new Map(
    blocks.map((block, index) => {
      const id = blockIds[index];
      if (id === undefined)
        throw new Error(`Missing block ID at index ${index}`);
      return [block.sourceKey, id] as const;
    }),
  );
};
