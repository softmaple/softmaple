import styled from "@emotion/styled";
import { styled as muiStyled } from "@mui/material";

export const TeXEditorContainer = muiStyled("div")(({ theme }) => ({
  color: theme.palette.text.secondary,
  cursor: "pointer",
  userSelect: "none",
}));

export const TeXEditorPanel = styled.div`
  font-family: "Helvetica", sans-serif;
  font-weight: 200;
  width: 100%;

  & textarea {
    border: 1px solid #e1e1e1;
    display: block;
    font-family: "Inconsolata", "Menlo", monospace;
    font-size: 14px;
    height: 110px;
    margin: 10px auto 10px;
    outline: none;
    padding: 14px;
    resize: none;
    -webkit-box-sizing: border-box;
    width: 100%;
  }
`;

export const TeXEditorButtonGroup = styled.div`
  text-align: center;
  display: flex;
  flex-wrap: wrap;
`;

const TeXEditorButtonBase = styled.button`
  background-color: #fff;
  border: 1px solid #0a0;
  cursor: pointer;
  font-family: "Helvetica", "Arial", sans-serif;
  font-size: 16px;
  font-weight: 200;
  margin: 10px auto;
  padding: 6px;
  -webkit-border-radius: 3px;
  width: 99px;
`;

type SaveButtonProps = { isInvalidTeX: boolean };

export const SaveButton = styled(TeXEditorButtonBase)(
  ({ isInvalidTeX }: SaveButtonProps) => ({
    backgroundColor: isInvalidTeX && "#eee",
    borderColor: isInvalidTeX && "#a00",
    color: isInvalidTeX && "#666",
  })
);

export const RemoveButton = styled(TeXEditorButtonBase)`
  border-color: #aaa;
  color: #999;
`;
