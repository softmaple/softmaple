// eslint-disable-next-line @typescript-eslint/no-unused-vars
const rootTypeToRootName = {
  root: "Root",
  table: "Table",
};

export const INITIAL_TOOLBAR_STATE = {
  canRedo: false,
  canUndo: false,
  blockType: "paragraph" as keyof typeof blockTypeToBlockName,
  isBold: false,
  isItalic: false,
  isUnderline: false,
  isStrikethrough: false,
  isCode: false,
  isLink: false,
  rootType: "root" as keyof typeof rootTypeToRootName,
};

export const blockTypeToBlockName = {
  bullet: "Bulleted List",
  check: "Check List",
  // code: "Code Block",
  h1: "Heading 1",
  h2: "Heading 2",
  h3: "Heading 3",
  h4: "Heading 4",
  h5: "Heading 5",
  h6: "Heading 6",
  number: "Numbered List",
  paragraph: "Normal",
  quote: "Quote",
};
