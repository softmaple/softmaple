import type { NodeKey } from "lexical";

export type ProjectedBlockType =
  | "paragraph"
  | "h1"
  | "h2"
  | "h3"
  | "quote"
  | "code"
  | "bullet-list"
  | "number-list"
  | "check-list";

export type ProjectedMarkKind =
  | "bold"
  | "italic"
  | "underline"
  | "strike"
  | "inline-code"
  | "link";

export interface ProjectedLinkValue {
  readonly url: string;
  readonly target?: string | null;
  readonly rel?: string | null;
  readonly title?: string | null;
}

interface ProjectedMarkRange {
  readonly from: number;
  readonly to: number;
}

export type ProjectedMark =
  | (ProjectedMarkRange & {
      readonly kind: Exclude<ProjectedMarkKind, "link">;
      readonly value?: never;
    })
  | (ProjectedMarkRange & {
      readonly kind: "link";
      readonly value: ProjectedLinkValue;
    });

export interface ProjectedBlockAttributes {
  readonly checked?: boolean;
  readonly language?: string | null;
  readonly theme?: string | null;
  readonly start?: number;
  readonly value?: number;
}

/**
 * Temporary Lexical projection. Node keys are deliberately process-local and
 * are never written into the collaborative document or copied with content.
 */
export interface ProjectedBlock {
  readonly sourceKey: NodeKey;
  readonly stableId?: string;
  readonly parentSourceKey?: NodeKey;
  readonly type: ProjectedBlockType;
  readonly text: string;
  readonly marks: ReadonlyArray<ProjectedMark>;
  readonly attributes: ProjectedBlockAttributes;
}

export interface ProjectedDocument {
  readonly blocks: ReadonlyArray<ProjectedBlock>;
}
