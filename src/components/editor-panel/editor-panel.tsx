import "draft-js/dist/Draft.css";
import {
  FC,
  useEffect,
  useRef,
  useState,
  KeyboardEvent,
  Dispatch,
  SetStateAction,
} from "react";
import {
  ContentBlock,
  ContentState,
  DraftHandleValue,
  Editor,
  EditorCommand,
  EditorState,
  getDefaultKeyBinding,
  RichUtils,
} from "draft-js";
import { Map } from "immutable";
import Skeleton from "@mui/material/Skeleton";
import { Toolbar } from "./toolbar";
import { insertCustomBlock, removeCustomBlock } from "./blocks/modifiers";
import { CustomBlock } from "./blocks/custom-block";
import { EditorContainer } from "./editor-panel.style";

type EditorPanelProps = {
  editorState: EditorState;
  setEditorState: Dispatch<SetStateAction<EditorState>>;
};

export const EditorPanel: FC<EditorPanelProps> = ({
  editorState,
  setEditorState,
}) => {
  const [liveCustomBlockEdits, setLiveCustomBlockEdits] = useState(Map());
  const [showEditor, setShowEditor] = useState(false);

  useEffect(() => {
    setShowEditor(true);
  }, []);

  const editorRef = useRef<Editor | null>(null);

  const focusEditor = () => {
    editorRef.current?.focus();
  };

  useEffect(() => {
    focusEditor();
  }, []);

  const onChange = (newEditorState: EditorState) => {
    setEditorState(newEditorState);
  };

  const insertEquation = () => {
    setLiveCustomBlockEdits(Map());
    setEditorState(
      insertCustomBlock(editorState, "MATH", {
        content: "\\sin{x^2} + \\cos{x^2} = 1",
      })
    );
  };

  const removeBlock = (blockKey: string) => {
    setLiveCustomBlockEdits(liveCustomBlockEdits.remove(blockKey));
    setEditorState(removeCustomBlock(editorState, blockKey));
  };

  const blockRenderer = (block: ContentBlock) => {
    if (block.getType() === "atomic") {
      return {
        component: CustomBlock,
        editable: false,
        props: {
          onRemove: (blockKey: string) => {
            removeBlock(blockKey);
          },
          onStart: (blockKey: string) => {
            setLiveCustomBlockEdits(liveCustomBlockEdits.set(blockKey, true));
          },
          onFinish: (blockKey: string, newContentState: ContentState) => {
            setLiveCustomBlockEdits(liveCustomBlockEdits.remove(blockKey));
            setEditorState(
              EditorState.push(
                editorState,
                newContentState,
                "change-block-data"
              )
            );
          },
        },
      };
    }
  };

  const mapKeyToEditorCommand = (
    e: KeyboardEvent<{}> /** compatible with draft-js utils */
  ): EditorCommand | null => {
    if (e.code === "Tab") {
      const newEditorState = RichUtils.onTab(e, editorState, 4 /* maxDepth */);
      if (newEditorState !== editorState) {
        onChange(newEditorState);
      }
      return null;
    }
    return getDefaultKeyBinding(e);
  };

  const handleKeyCommand = (
    command: EditorCommand,
    newEditorState: EditorState
  ): DraftHandleValue => {
    const newState = RichUtils.handleKeyCommand(newEditorState, command);
    if (newState) {
      onChange(newState);
      return "handled";
    }
    return "not-handled";
  };

  const toggleInlineStyle = (inlineStyle: string) => {
    onChange(RichUtils.toggleInlineStyle(editorState, inlineStyle));
  };

  const toggleBlockType = (blockType: string) => {
    switch (blockType) {
      case "math":
        return insertEquation();

      default:
        break;
    }
    onChange(RichUtils.toggleBlockType(editorState, blockType));
  };

  const contentState = editorState.getCurrentContent();
  const firstBlockStyle = contentState.getBlockMap().first().getType();
  /**
   * If the user changes block type before entering any text, we can
   * either style the placeholder or hide it. Let's just hide it now.
   */
  const shouldHidePlaceholder =
    !contentState.hasText() && firstBlockStyle !== "unstyled";

  return (
    <>
      <Toolbar
        editorState={editorState}
        toggleInlineStyle={toggleInlineStyle}
        toggleBlockType={toggleBlockType}
      />

      <EditorContainer
        shouldHidePlaceholder={shouldHidePlaceholder}
        onClick={focusEditor}
      >
        {showEditor ? (
          <Editor
            ref={editorRef}
            editorState={editorState}
            onChange={onChange}
            placeholder="Write something..."
            blockRendererFn={blockRenderer}
            keyBindingFn={mapKeyToEditorCommand}
            // @ts-ignore incompatible types (boolean vs number)
            readOnly={liveCustomBlockEdits.count()}
            spellCheck
            handleKeyCommand={handleKeyCommand}
          />
        ) : (
          // TODO: Loading Button is better.
          <Skeleton variant="rectangular" width="100%" height="100%" />
        )}
      </EditorContainer>
    </>
  );
};
