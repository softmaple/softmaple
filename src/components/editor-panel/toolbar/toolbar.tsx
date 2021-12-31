import type {
  DraftInlineStyleType,
  DraftBlockType,
  EditorState,
} from "draft-js";
import { FC } from "react";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import ToggleButton from "@mui/material/ToggleButton";
import Tooltip from "@mui/material/Tooltip";
import FormatBoldIcon from "@mui/icons-material/FormatBold";
import FormatItalicIcon from "@mui/icons-material/FormatItalic";
import FormatUnderlinedIcon from "@mui/icons-material/FormatUnderlined";
import CodeIcon from "@mui/icons-material/Code";
import FunctionsIcon from "@mui/icons-material/Functions";
import FormatListBulletedIcon from "@mui/icons-material/FormatListBulleted";
import FormatListNumberedIcon from "@mui/icons-material/FormatListNumbered";

const H1: FC<any> = () => <b>H1</b>;
const H2: FC<any> = () => <b>H2</b>;
const H3: FC<any> = () => <b>H3</b>;

type StylesType = {
  label: string;
  inlineStyle?: DraftInlineStyleType;
  blockType?: DraftBlockType;
  icon: JSX.Element;
};

const INLINE_STYLES: StylesType[] = [
  { label: "Bold", inlineStyle: "BOLD", icon: <FormatBoldIcon /> },
  { label: "Italic", inlineStyle: "ITALIC", icon: <FormatItalicIcon /> },
  {
    label: "Underline",
    inlineStyle: "UNDERLINE",
    icon: <FormatUnderlinedIcon />,
  },
  { label: "Monospace", inlineStyle: "CODE", icon: <CodeIcon /> },
];

const BLOCK_TYPES: StylesType[] = [
  { label: "H1", blockType: "header-one", icon: <H1 /> },
  { label: "H2", blockType: "header-two", icon: <H2 /> },
  { label: "H3", blockType: "header-three", icon: <H3 /> },
  // {label: 'H4', blockType: 'header-four'},
  // {label: 'H5', blockType: 'header-five'},
  // {label: 'H6', blockType: 'header-six'},
  { label: "Math", blockType: "math", icon: <FunctionsIcon /> },
  // { label: "Image", blockType: "image-block" },
  // {label: 'Blockquote', blockType: 'blockquote'},
  {
    label: "UL",
    blockType: "unordered-list-item",
    icon: <FormatListBulletedIcon />,
  },
  {
    label: "OL",
    blockType: "ordered-list-item",
    icon: <FormatListNumberedIcon />,
  },
  // {label: 'Code Block', blockType: 'code-block'},
];

const CONTROLS = [...INLINE_STYLES, ...BLOCK_TYPES];

export type ToobarProps = {
  editorState: EditorState;
  /** inline style controls */
  toggleInlineStyle?: (inlineStyle: string) => void;
  /** block type controls */
  toggleBlockType?: (blockType: string) => void;
};

export const Toolbar: FC<ToobarProps> = ({
  editorState,
  toggleInlineStyle,
  toggleBlockType,
}) => {
  const onMouseDown = (
    e: React.MouseEvent<HTMLButtonElement>,
    isInlineStyle: boolean,
    control: string
  ) => {
    // only pick one callback at a time
    if (isInlineStyle) {
      toggleInlineStyle(control);
    } else {
      toggleBlockType(control);
    }
  };

  return (
    <ToggleButtonGroup aria-label="text formatting">
      {CONTROLS.map(({ label, inlineStyle, blockType, icon }) => {
        const isInlineStyle = inlineStyle ? true : false;
        const control = inlineStyle ?? blockType;
        const selected =
          editorState.getCurrentInlineStyle().has(control) ||
          editorState
            .getCurrentContent()
            .getBlockForKey(editorState.getSelection().getStartKey())
            .getType() === control;

        return (
          <Tooltip title={label} key={label} placement="top">
            <ToggleButton
              key={label}
              value={label}
              arial-label={label}
              selected={selected}
              onMouseDown={(e) => onMouseDown(e, isInlineStyle, control)}
            >
              {icon}
            </ToggleButton>
          </Tooltip>
        );
      })}
    </ToggleButtonGroup>
  );
};
