import { ContentBlock, ContentState } from "draft-js";

export type CustomBlockType = {
  block: ContentBlock;
  contentState: ContentState;
  /** do not rename `blockProps`, it's default. */
  blockProps: {
    onStart?: (blockKey: string) => void;
    onFinish?: (blockKey: string, newContentState: ContentState) => void;
    onRemove?: (blockKey: string) => void;
  };
};
