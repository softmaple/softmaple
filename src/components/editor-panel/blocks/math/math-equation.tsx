import "katex/dist/katex.min.css";
import { ContentState } from "draft-js";
import katex from "katex";
import { FC, useRef, useState } from "react";
import classNames from "classnames";
import type { CustomBlockType } from "@/components/editor-panel/blocks/type";
import { Output } from "./output";

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
    console.log("removing block");
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
    <div
      className={classNames("TeXEditor-tex", {
        "TeXEditor-activeTeX": isEditMode,
      })}
    >
      <Output content={content} onClick={onClick} />
      {isEditMode && ( // display edit panel
        <div className="TeXEditor-panel">
          <textarea
            className="TeXEditor-texValue"
            onChange={onChange}
            ref={textareaRef}
            value={value}
          />
          <div className="TeXEditor-buttons">
            <button
              className={classNames("TeXEditor-saveButton", {
                "TeXEditor-invalidButton": isInvalidTeX,
              })}
              disabled={isInvalidTeX}
              onClick={save}
              type="button"
            >
              {isInvalidTeX ? "Invalid TeX" : "Done"}
            </button>
            <button
              className="TeXEditor-removeButton"
              onClick={remove}
              type="button"
            >
              Remove
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
