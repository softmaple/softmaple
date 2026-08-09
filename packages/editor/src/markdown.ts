import { $convertToMarkdownString } from "@lexical/markdown";
import type { EditorState, LexicalEditor } from "lexical";
import { PLAYGROUND_TRANSFORMERS } from "@softmaple/editor/components/core/plugins/MarkdownTransformers/MarkdownTransformers";

export const lexicalStateToMarkdown = (editorState: EditorState): string =>
  editorState.read(() =>
    $convertToMarkdownString(PLAYGROUND_TRANSFORMERS, undefined, true),
  );

export const lexicalEditorToMarkdown = (editor: LexicalEditor): string =>
  lexicalStateToMarkdown(editor.getEditorState());
