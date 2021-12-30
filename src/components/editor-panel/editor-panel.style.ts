import styled from "@emotion/styled";

type HidePlaceHolderProps = { shouldHidePlaceholder: boolean };

const HidePlaceHolder = styled.div(
  ({ shouldHidePlaceholder }: HidePlaceHolderProps) => ({
    "& .public-DraftEditorPlaceholder-root": {
      display: shouldHidePlaceholder && "none",
    },
  })
);

export const EditorContainer = styled(HidePlaceHolder)`
  grid-area: 2 / 1 / 3 / 2;
  box-shadow: -1px -1px 13px 3px black;
  cursor: text;
  font-size: 16px;
  padding: 9px;
  overflow-x: hidden;
  overflow-y: auto;

  & .public-DraftEditorPlaceholder-root,
  & .public-DraftEditor-content {
    margin: 0 -15px -15px;
    padding: 15px;
  }

  & .public-DraftEditor-content {
    min-height: 100px;
  }

  & .RichEditor-blockquote {
    border-left: 5px solid #eee;
    color: #666;
    font-family: "Hoefler Text", "Georgia", serif;
    font-style: italic;
    margin: 16px 0;
    padding: 10px 20px;
  }

  & .public-DraftStyleDefault-pre {
    background-color: rgba(0, 0, 0, 0.05);
    font-family: "Inconsolata", "Menlo", "Consolas", monospace;
    font-size: 16px;
    padding: 20px;
  }
`;
