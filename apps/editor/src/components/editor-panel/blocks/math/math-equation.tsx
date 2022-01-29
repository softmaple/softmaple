import { ContentState } from "draft-js";
import { FC, useRef, useState } from "react";
import type { CustomBlockType } from "@/components/editor-panel/blocks/types";
import { Output } from "./output";
import {
  RemoveButton,
  SaveButton,
  TeXEditorButtonGroup,
  TeXEditorContainer,
  TeXEditorPanel,
} from "./math-equation.style";

export const MathEquation: FC<CustomBlockType> = ({
  block,
  contentState,
  blockProps,
}) => {
  const [isEditMode, setIsEditMode] = useState(false);
  const [value, setValue] = useState("");
  const [isInvalidTeX, setIsInvalidTeX] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const getValue = () => {
    return contentState.getEntity(block.getEntityAt(0)).getData().content;
  };

  const onChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    let invalid = false;

    try {
      // @ts-ignore use CDN instead.
      katex.renderToString(e.target.value);
    } catch (e) {
      invalid = true;
    } finally {
      setIsInvalidTeX(invalid);
      setValue(e.target.value);
    }
  };

  const remove = () => {
    blockProps?.onRemove(block.getKey());
  };

  const startEdit = () => {
    blockProps?.onStart(block.getKey());
  };

  const finishEdit = (newContentState: ContentState) => {
    blockProps?.onFinish(block.getKey(), newContentState);
  };

  const onClick = () => {
    if (!isEditMode) {
      setIsEditMode(true);
      setValue(getValue());
      startEdit();
    }
  };

  const save = () => {
    const entityKey = block.getEntityAt(0);
    const newContentState = contentState.mergeEntityData(entityKey, {
      content: value,
    });
    setIsInvalidTeX(false);
    setIsEditMode(false);
    setValue("");
    finishEdit(newContentState);
  };

  let content: string;

  if (isEditMode) {
    if (isInvalidTeX) {
      content = "";
    } else {
      content = value;
    }
  } else {
    content = getValue();
  }

  return (
    <TeXEditorContainer>
      <Output content={content} onClick={onClick} />
      {isEditMode && ( // display edit panel
        <TeXEditorPanel>
          <textarea onChange={onChange} ref={textareaRef} value={value} />
          <TeXEditorButtonGroup>
            <SaveButton
              style={{
                backgroundColor: isInvalidTeX && "#eee",
                borderColor: isInvalidTeX && "#a00",
                color: isInvalidTeX && "#666",
              }}
              disabled={isInvalidTeX}
              onClick={save}
              type="button"
            >
              {isInvalidTeX ? "Invalid TeX" : "Done"}
            </SaveButton>
            <RemoveButton onClick={remove} type="button">
              Remove
            </RemoveButton>
          </TeXEditorButtonGroup>
        </TeXEditorPanel>
      )}
    </TeXEditorContainer>
  );
};
