import { MarkdownShortcutPlugin } from "@lexical/react/LexicalMarkdownShortcutPlugin";
import { PLAYGROUND_TRANSFORMERS } from "@softmaple/editor/components/core/plugins/MarkdownTransformers/MarkdownTransformers";

export const MarkdownPlugin = () => {
  return <MarkdownShortcutPlugin transformers={PLAYGROUND_TRANSFORMERS} />;
};
