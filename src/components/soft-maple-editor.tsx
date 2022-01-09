import { useEffect, useState } from "react";
import { convertFromRaw, EditorState } from "draft-js";
import styled from "@emotion/styled";
import { EditorPanel } from "./editor-panel";
import { PreviewPanel } from "./preview-panel";
import { Header } from "./header";

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

/**
 * trick for Next.js
 * @see https://github.com/facebook/draft-js/issues/2332#issuecomment-761573306
 */
const emptyContentState = convertFromRaw({
  entityMap: {},
  blocks: [
    {
      text: "",
      key: "foo",
      type: "unstyled",
      entityRanges: [],
      inlineStyleRanges: [],
      depth: 0,
    },
  ],
});

export const SoftMapleEditor = () => {
  const [editorState, setEditorState] = useState(
    EditorState.createWithContent(emptyContentState)
  );

  useEffect(() => {
    const history = localStorage.getItem("rawContent");
    const rawContent = JSON.parse(history);
    if (history) {
      setEditorState(EditorState.createWithContent(convertFromRaw(rawContent)));
    }
  }, []);

  const contentState = editorState.getCurrentContent();

  return (
    <>
      {/* the same as https://github.com/SoftMaple/github-insights-view/tree/main/src/components/header */}
      <Header>{""}</Header>
      <Layout>
        <EditorPanel
          editorState={editorState}
          setEditorState={setEditorState}
        />
        <PreviewPanel contentState={contentState} />
      </Layout>
    </>
  );
};
