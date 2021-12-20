import styled from "@emotion/styled";
import { ContentState } from "draft-js";
import { FC, useState } from "react";
import Button from "@mui/material/Button";
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
const PrismContainer = styled.div`
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
      <PrismContainer>
        <pre>
          <code className="language-latex">{sourceCode || ""}</code>
        </pre>
      </PrismContainer>
    </>
  );
};
