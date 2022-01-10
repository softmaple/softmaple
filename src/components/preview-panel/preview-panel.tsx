import "highlight.js/styles/github.css";
import { ContentState, convertToRaw } from "draft-js";
import { FC, useEffect, useState } from "react";
import Button from "@mui/material/Button";
import Tooltip from "@mui/material/Tooltip";
import hljs from "highlight.js";
import latex from "highlight.js/lib/languages/latex";
import { scan } from "@zhyd1997/draftjs-to-latex";
import {
  SourceCodeContainer,
  SourceCodeWrapper,
  StyledCopyButton,
  StyledMenu,
} from "./preview-panel.style";

hljs.registerLanguage("latex", latex);

type PreviewPanelProps = {
  contentState: ContentState;
};

export const PreviewPanel: FC<PreviewPanelProps> = ({ contentState }) => {
  const hasText = contentState.hasText();
  const [clipboardTitle, setClipboardTitle] = useState("Copy to clipboard");
  const [sourceCode, setSourceCode] = useState("");

  useEffect(() => {
    // IMPORTANT: when souce code is generated, highlight it
    if (sourceCode) {
      hljs.highlightAll();
    }
  }, [sourceCode]);

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

  const copyToClipboard = async () => {
    await navigator.clipboard.writeText(sourceCode);
    setClipboardTitle("Copied!");
    setTimeout(() => {
      setClipboardTitle("Copy to clipboard");
    }, 1000);
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
      <SourceCodeContainer>
        {sourceCode && (
          <Tooltip title={clipboardTitle} placement="top">
            <StyledCopyButton onClick={copyToClipboard} />
          </Tooltip>
        )}
        <SourceCodeWrapper>
          <code className="language-latex">{sourceCode}</code>
        </SourceCodeWrapper>
      </SourceCodeContainer>
    </>
  );
};
