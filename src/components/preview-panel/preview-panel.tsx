import "highlight.js/styles/github.css";
import { ContentState } from "draft-js";
import { FC, useEffect, useState } from "react";
import Button from "@mui/material/Button";
import Tooltip from "@mui/material/Tooltip";
import hljs from "highlight.js";
import { scan } from "@zhyd1997/draftjs-to-latex";
import {
  SourceCodeContainer,
  SourceCodeWrapper,
  StyledCopyButton,
  StyledMenu,
} from "./preview-panel.style";

type PreviewPanelProps = {
  contentState: ContentState;
};

export const PreviewPanel: FC<PreviewPanelProps> = ({ contentState }) => {
  const [clipboardTitle, setClipboardTitle] = useState("Copy to clipboard");
  const [sourceCode, setSourceCode] = useState("");

  useEffect(() => {
    // IMPORTANT: when souce code is generated, highlight it
    if (sourceCode) {
      hljs.highlightAll();
    }
  }, [sourceCode]);

  const onClick = () => {
    const generated = scan(contentState);
    setSourceCode(generated);
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
        <Button
          variant="contained"
          disabled={!contentState.hasText()}
          onClick={onClick}
        >
          Preview
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
