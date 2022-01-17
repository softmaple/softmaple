import { ContentState, convertToRaw } from "draft-js";
import { Dispatch, FC, SetStateAction, useState } from "react";
import type { PaletteMode } from "@mui/material";
import Button from "@mui/material/Button";
import { scan } from "@zhyd1997/draftjs-to-latex";
import { StyledMenu } from "./preview-panel.style";
import { LaTeXContainer } from "./latex-containier";

type PreviewPanelProps = {
  mode: PaletteMode;
  contentState: ContentState;
  setShowAlert: Dispatch<SetStateAction<boolean>>;
};

export const PreviewPanel: FC<PreviewPanelProps> = ({
  mode,
  contentState,
  setShowAlert,
}) => {
  const hasText = contentState.hasText();
  const [sourceCode, setSourceCode] = useState<string>("");
  const [isManuallySaved, setIsManuallySaved] = useState<boolean>(false);

  const handleSave = () => {
    const rawContent = convertToRaw(contentState);
    localStorage.setItem("rawContent", JSON.stringify(rawContent));
  };

  /**
   * TODO: seems like has some bugs
   */
  if (hasText) {
    /**
     * Why use nested setTimeout instead of setInterval?
     * @see https://javascript.info/settimeout-setinterval#nested-settimeout
     */
    setTimeout(function save() {
      handleSave();
      setTimeout(save, 5000);
    }, 5000);
  }

  const handlePreview = () => {
    const generated = scan(contentState);
    setSourceCode(generated);
    handleSave();
  };

  const onSave = () => {
    handleSave();
    // control alert and CTA buttons
    setShowAlert(true);
    setIsManuallySaved(true);
    setTimeout(() => {
      setShowAlert(false);
      setIsManuallySaved(false);
    }, 2000);
  };

  const disabled = !hasText || isManuallySaved;

  return (
    <>
      <StyledMenu>
        <Button variant="contained" disabled={disabled} onClick={handlePreview}>
          Preview
        </Button>
        <Button
          variant="contained"
          color="success"
          disabled={disabled}
          onClick={onSave}
        >
          {isManuallySaved ? "Saved" : "Save"}
        </Button>
      </StyledMenu>
      <LaTeXContainer mode={mode} sourceCode={sourceCode} />
    </>
  );
};
