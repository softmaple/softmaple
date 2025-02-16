import { useEffect, useState } from "react";
import { convertFromRaw, EditorState } from "draft-js";
import styled from "@emotion/styled";
import type { PaletteMode } from "@mui/material";
import Alert from "@mui/material/Alert";
import { Header, Layout, Palette, Footer } from "ui";
import { EditorPanel } from "./editor-panel";
import { PreviewPanel } from "./preview-panel";

const NetlifyBanner = styled.div`
  display: flex;
  justify-content: flex-start;
`;

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
const MainLayout = styled.div`
  position: absolute;
  inset: 48px 20px;
  display: grid;
  grid-gap: 1rem;
  grid-template-columns: repeat(2, [col] calc(50% - 10px));
  grid-template-rows: 40px auto;
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
  const [mode, setMode] = useState<PaletteMode>("light");
  const [showAlert, setShowAlert] = useState<boolean>(false);
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

  const onClose = () => setShowAlert(false);

  const contentState = editorState.getCurrentContent();

  return (
    <Layout mode={mode}>
      <Header>
        <Palette mode={mode} setMode={setMode} />
      </Header>
      {showAlert && <Alert onClose={onClose}>Saved successfully</Alert>}
      <MainLayout>
        <EditorPanel
          editorState={editorState}
          setEditorState={setEditorState}
        />
        <PreviewPanel
          mode={mode}
          contentState={contentState}
          setShowAlert={setShowAlert}
        />
      </MainLayout>

      <Footer>
        <NetlifyBanner>
          <a href="https://www.netlify.com">
            {" "}
            <img
              src="https://www.netlify.com/v3/img/components/netlify-color-accent.svg"
              alt="Deploys by Netlify"
              width={114}
              height={50}
            />{" "}
          </a>
        </NetlifyBanner>
      </Footer>
    </Layout>
  );
};
