import "highlight.js/styles/github.css";
import { ContentState, convertToRaw } from "draft-js";
import { FC, useState } from "react";
import type { PaletteMode } from "@mui/material";
import Button from "@mui/material/Button";
import { scan } from "@zhyd1997/draftjs-to-latex";
import { StyledMenu } from "./preview-panel.style";
import { LaTeXContainer } from "./latex-containier";

type PreviewPanelProps = {
  mode: PaletteMode;
  contentState: ContentState;
};

export const PreviewPanel: FC<PreviewPanelProps> = ({ mode, contentState }) => {
  const hasText = contentState.hasText();
  const [sourceCode, setSourceCode] = useState("");

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

  return (
    <>
      <StyledMenu>
        <Button variant="contained" disabled={!hasText} onClick={handlePreview}>
          Preview
        </Button>
        <Button
          variant="contained"
          color="success"
          disabled={!hasText}
          onClick={handleSave}
        >
          Save
        </Button>
      </StyledMenu>
      <LaTeXContainer mode={mode} sourceCode={sourceCode} />
    </>
  );
};
