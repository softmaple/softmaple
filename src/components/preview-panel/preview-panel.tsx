import "highlight.js/styles/github.css";
import styled from "@emotion/styled";
import { ContentState } from "draft-js";
import { FC, useEffect, useState } from "react";
import Button from "@mui/material/Button";
import Tooltip from "@mui/material/Tooltip";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import hljs from "highlight.js";
import { scan } from "@zhyd1997/draftjs-to-latex";

const StyledMenu = styled.div`
  display: flex;
  position: relative;
  padding: 6px;
`;

/**
 * container vs wrapper
 * @see https://stackoverflow.com/a/33404137/8537000
 */
const SourceCodeContainer = styled.div`
  position: relative;
  padding: 9px;
  box-shadow: -1px -1px 13px 3px black;
  // overflow-x: hidden;
  overflow-y: auto;
`;

const StyledCopyButton = styled(ContentCopyIcon)`
  color: rgba(0.68, 0.68, 0.68, 0.5);
  position: absolute;
  right: 1rem;

  &:hover {
    cursor: pointer;
    transform: scale(1.25);
  }
`;

const SourceCodeWrapper = styled.pre`
  margin: 0;
  white-space: pre-wrap;
  word-wrap: break-word;
`;

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
        <Tooltip title={clipboardTitle} placement="top">
          <StyledCopyButton onClick={copyToClipboard} />
        </Tooltip>
        <SourceCodeWrapper>
          <code className="language-latex">{sourceCode || ""}</code>
        </SourceCodeWrapper>
      </SourceCodeContainer>
    </>
  );
};
