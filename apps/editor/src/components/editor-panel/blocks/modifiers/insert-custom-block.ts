import { AtomicBlockUtils, EditorState, DraftEntityType } from "draft-js";

export function insertCustomBlock(
  editorState: EditorState,
  type: DraftEntityType,
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
