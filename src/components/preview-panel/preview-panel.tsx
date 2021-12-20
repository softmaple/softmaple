import "highlight.js/styles/github.css";
import styled from "@emotion/styled";
import { ContentState } from "draft-js";
import { FC, useEffect, useState } from "react";
import Button from "@mui/material/Button";
import hljs from "highlight.js";
import { scan } from "./utils";

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
  padding: 9px;
  box-shadow: -1px -1px 13px 3px black;
  // overflow-x: hidden;
  overflow-y: auto;
`;

type PreviewPanelProps = {
  contentState: ContentState;
};

export const PreviewPanel: FC<PreviewPanelProps> = ({ contentState }) => {
  const [sourceCode, setSourceCode] = useState("");

  const onClick = () => {
    const generated = scan(contentState);
    setSourceCode(generated);
  };

  useEffect(() => {
    // IMPORTANT: when souce code is generated, highlight it
    if (sourceCode) {
      hljs.highlightAll();
    }
  }, [sourceCode]);

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
        <pre>
          <code className="language-latex">{sourceCode || ""}</code>
        </pre>
      </SourceCodeContainer>
    </>
  );
};
