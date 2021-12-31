import styled from "@emotion/styled";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";

export const StyledMenu = styled.div`
  display: flex;
  position: relative;
  padding: 6px;
`;

/**
 * container vs wrapper
 * @see https://stackoverflow.com/a/33404137/8537000
 */
export const SourceCodeContainer = styled.div`
  position: relative;
  padding: 9px;
  box-shadow: -1px -1px 13px 3px black;
  // overflow-x: hidden;
  overflow-y: auto;
`;

export const StyledCopyButton = styled(ContentCopyIcon)`
  color: rgba(0.68, 0.68, 0.68, 0.5);
  position: absolute;
  right: 1rem;

  &:hover {
    cursor: pointer;
    transform: scale(1.25);
  }
`;

export const SourceCodeWrapper = styled.pre`
  margin: 0;
  white-space: pre-wrap;
  word-wrap: break-word;
`;
