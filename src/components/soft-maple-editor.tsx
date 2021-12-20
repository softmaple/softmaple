import { useEffect, useState } from "react";
import { convertFromRaw, convertToRaw, EditorState } from "draft-js";
import styled from "@emotion/styled";
import { EditorPanel } from "./editor-panel";
import { PreviewPanel } from "./preview-panel";

/**
 * Main Layout: (Grid)
 *
 * --------------------------------------
 * Editor Menu     |   |   Preview Menu
 * ----------------|   | ----------------
 *      gutter       g         gutter
 * ----------------| u | ----------------
 *                 | t |
 *                 | t |
 * Editor Panel    | e | Prism Container
 *                 | r |
 *                 |   |
 * ----------------|   |------------------
 */
const Layout = styled.div`
  margin: 3.125em;
  display: grid;
  grid-gap: 1rem;
  grid-template-columns: repeat(2, [col] calc(50% - 10px));
  grid-template-rows: 40px 80vh;
  background-color: #fff;
  color: #444;
`;

export const SoftMapleEditor = () => {
  const [editorState, setEditorState] = useState(EditorState.createEmpty());

  useEffect(() => {
    const history = localStorage.getItem("rawContent");
    const rawContent = JSON.parse(history);
    if (history) {
      setEditorState(EditorState.createWithContent(convertFromRaw(rawContent)));
    }
  }, []);

  const contentState = editorState.getCurrentContent();

  if (contentState.hasText()) {
    const rawContent = convertToRaw(contentState);
    /**
     * Why use nested setTimeout instead of setInterval?
     * @see https://javascript.info/settimeout-setinterval#nested-settimeout
     */
    setTimeout(function save() {
      localStorage.setItem("rawContent", JSON.stringify(rawContent));
      setTimeout(save, 5000);
    }, 100);
  }

  return (
    <Layout>
      <EditorPanel editorState={editorState} setEditorState={setEditorState} />
      <PreviewPanel contentState={contentState} />
    </Layout>
  );
};
