import { AtomicBlockUtils, EditorState } from "draft-js";

export function insertCustomBlock(
  editorState: EditorState,
  type: string,
  data?: Record<string, unknown>
): EditorState {
  const contentState = editorState.getCurrentContent();
  const contentStateWithEntity = contentState.createEntity(
    type,
    "IMMUTABLE",
    data
  );
  const entityKey = contentStateWithEntity.getLastCreatedEntityKey();
  const newEditorState = EditorState.set(editorState, {
    currentContent: contentStateWithEntity,
  });
  return AtomicBlockUtils.insertAtomicBlock(newEditorState, entityKey, " ");
}
