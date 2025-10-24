import { IS_APPLE } from "@lexical/utils";
import { isModifierMatch } from "lexical";

export const SHORTCUTS = Object.freeze({
  // (Ctrl|⌘) + (Alt|Option) + <key> shortcuts
  NORMAL: IS_APPLE ? "⌘+Opt+0" : "Ctrl+Alt+0",
  HEADING1: IS_APPLE ? "⌘+Opt+1" : "Ctrl+Alt+1",
  HEADING2: IS_APPLE ? "⌘+Opt+2" : "Ctrl+Alt+2",
  HEADING3: IS_APPLE ? "⌘+Opt+3" : "Ctrl+Alt+3",
  NUMBERED_LIST: IS_APPLE ? "⌘+Shift+7" : "Ctrl+Shift+7",
  BULLET_LIST: IS_APPLE ? "⌘+Shift+8" : "Ctrl+Shift+8",
  CHECK_LIST: IS_APPLE ? "⌘+Shift+9" : "Ctrl+Shift+9",
  CODE_BLOCK: IS_APPLE ? "⌘+Opt+C" : "Ctrl+Alt+C",
  QUOTE: IS_APPLE ? "⌃+Shift+Q" : "Ctrl+Shift+Q",
  ADD_COMMENT: IS_APPLE ? "⌘+Opt+M" : "Ctrl+Alt+M",

  // (Ctrl|⌘) + Shift + <key> shortcuts
  INCREASE_FONT_SIZE: IS_APPLE ? "⌘+Shift+." : "Ctrl+Shift+.",
  DECREASE_FONT_SIZE: IS_APPLE ? "⌘+Shift+," : "Ctrl+Shift+,",
  INSERT_CODE_BLOCK: IS_APPLE ? "⌘+Shift+C" : "Ctrl+Shift+C",
  STRIKETHROUGH: IS_APPLE ? "⌘+Shift+X" : "Ctrl+Shift+X",
  LOWERCASE: IS_APPLE ? "⌃+Shift+1" : "Ctrl+Shift+1",
  UPPERCASE: IS_APPLE ? "⌃+Shift+2" : "Ctrl+Shift+2",
  CAPITALIZE: IS_APPLE ? "⌃+Shift+3" : "Ctrl+Shift+3",
  CENTER_ALIGN: IS_APPLE ? "⌘+Shift+E" : "Ctrl+Shift+E",
  JUSTIFY_ALIGN: IS_APPLE ? "⌘+Shift+J" : "Ctrl+Shift+J",
  LEFT_ALIGN: IS_APPLE ? "⌘+Shift+L" : "Ctrl+Shift+L",
  RIGHT_ALIGN: IS_APPLE ? "⌘+Shift+R" : "Ctrl+Shift+R",

  // (Ctrl|⌘) + <key> shortcuts
  SUBSCRIPT: IS_APPLE ? "⌘+," : "Ctrl+,",
  SUPERSCRIPT: IS_APPLE ? "⌘+." : "Ctrl+.",
  INDENT: IS_APPLE ? "⌘+]" : "Ctrl+]",
  OUTDENT: IS_APPLE ? "⌘+[" : "Ctrl+[",
  CLEAR_FORMATTING: IS_APPLE ? "⌘+\\" : "Ctrl+\\",
  REDO: IS_APPLE ? "⌘+Shift+Z" : "Ctrl+Y",
  UNDO: IS_APPLE ? "⌘+Z" : "Ctrl+Z",
  BOLD: IS_APPLE ? "⌘+B" : "Ctrl+B",
  ITALIC: IS_APPLE ? "⌘+I" : "Ctrl+I",
  UNDERLINE: IS_APPLE ? "⌘+U" : "Ctrl+U",
  INSERT_LINK: IS_APPLE ? "⌘+K" : "Ctrl+K",
});

const CONTROL_OR_META = { ctrlKey: !IS_APPLE, metaKey: IS_APPLE };

export const isFormatParagraph = (event: KeyboardEvent): boolean => {
  const { code } = event;
  return (
    (code === "Numpad0" || code === "Digit0") &&
    isModifierMatch(event, { ...CONTROL_OR_META, altKey: true })
  );
};

export const isFormatHeading = (event: KeyboardEvent): boolean => {
  const { code } = event;

  if (!code) {
    return false;
  }

  const keyNumber = code[code.length - 1];

  if (!keyNumber) {
    return false;
  }

  return (
    ["1", "2", "3"].includes(keyNumber) &&
    isModifierMatch(event, { ...CONTROL_OR_META, altKey: true })
  );
};

export const isFormatNumberedList = (event: KeyboardEvent): boolean => {
  const { code } = event;
  return (
    (code === "Numpad7" || code === "Digit7") &&
    isModifierMatch(event, { ...CONTROL_OR_META, shiftKey: true })
  );
};

export const isFormatBulletList = (event: KeyboardEvent): boolean => {
  const { code } = event;
  return (
    (code === "Numpad8" || code === "Digit8") &&
    isModifierMatch(event, { ...CONTROL_OR_META, shiftKey: true })
  );
};

export const isFormatCheckList = (event: KeyboardEvent): boolean => {
  const { code } = event;
  return (
    (code === "Numpad9" || code === "Digit9") &&
    isModifierMatch(event, { ...CONTROL_OR_META, shiftKey: true })
  );
};

export const isFormatCode = (event: KeyboardEvent): boolean => {
  const { code } = event;
  return (
    code === "KeyC" &&
    isModifierMatch(event, { ...CONTROL_OR_META, altKey: true })
  );
};

export const isFormatQuote = (event: KeyboardEvent): boolean => {
  const { code } = event;
  return (
    code === "KeyQ" &&
    isModifierMatch(event, {
      ctrlKey: true,
      shiftKey: true,
    })
  );
};

export const isLowercase = (event: KeyboardEvent): boolean => {
  const { code } = event;
  return (
    (code === "Numpad1" || code === "Digit1") &&
    isModifierMatch(event, { ctrlKey: true, shiftKey: true })
  );
};

export const isUppercase = (event: KeyboardEvent): boolean => {
  const { code } = event;
  return (
    (code === "Numpad2" || code === "Digit2") &&
    isModifierMatch(event, { ctrlKey: true, shiftKey: true })
  );
};

export const isCapitalize = (event: KeyboardEvent): boolean => {
  const { code } = event;
  return (
    (code === "Numpad3" || code === "Digit3") &&
    isModifierMatch(event, { ctrlKey: true, shiftKey: true })
  );
};

export const isStrikeThrough = (event: KeyboardEvent): boolean => {
  const { code } = event;
  return (
    code === "KeyX" &&
    isModifierMatch(event, { ...CONTROL_OR_META, shiftKey: true })
  );
};

export const isIndent = (event: KeyboardEvent): boolean => {
  const { code } = event;
  return code === "BracketRight" && isModifierMatch(event, CONTROL_OR_META);
};

export const isOutdent = (event: KeyboardEvent): boolean => {
  const { code } = event;
  return code === "BracketLeft" && isModifierMatch(event, CONTROL_OR_META);
};

export const isCenterAlign = (event: KeyboardEvent): boolean => {
  const { code } = event;
  return (
    code === "KeyE" &&
    isModifierMatch(event, { ...CONTROL_OR_META, shiftKey: true })
  );
};

export const isLeftAlign = (event: KeyboardEvent): boolean => {
  const { code } = event;
  return (
    code === "KeyL" &&
    isModifierMatch(event, { ...CONTROL_OR_META, shiftKey: true })
  );
};

export const isRightAlign = (event: KeyboardEvent): boolean => {
  const { code } = event;
  return (
    code === "KeyR" &&
    isModifierMatch(event, { ...CONTROL_OR_META, shiftKey: true })
  );
};

export const isJustifyAlign = (event: KeyboardEvent): boolean => {
  const { code } = event;
  return (
    code === "KeyJ" &&
    isModifierMatch(event, { ...CONTROL_OR_META, shiftKey: true })
  );
};

export const isSubscript = (event: KeyboardEvent): boolean => {
  const { code } = event;
  return code === "Comma" && isModifierMatch(event, CONTROL_OR_META);
};

export const isSuperscript = (event: KeyboardEvent): boolean => {
  const { code } = event;
  return code === "Period" && isModifierMatch(event, CONTROL_OR_META);
};

export const isInsertCodeBlock = (event: KeyboardEvent): boolean => {
  const { code } = event;
  return (
    code === "KeyC" &&
    isModifierMatch(event, { ...CONTROL_OR_META, shiftKey: true })
  );
};

export const isIncreaseFontSize = (event: KeyboardEvent): boolean => {
  const { code } = event;
  return (
    code === "Period" &&
    isModifierMatch(event, { ...CONTROL_OR_META, shiftKey: true })
  );
};

export const isDecreaseFontSize = (event: KeyboardEvent): boolean => {
  const { code } = event;
  return (
    code === "Comma" &&
    isModifierMatch(event, { ...CONTROL_OR_META, shiftKey: true })
  );
};

export const isClearFormatting = (event: KeyboardEvent): boolean => {
  const { code } = event;
  return code === "Backslash" && isModifierMatch(event, CONTROL_OR_META);
};

export const isInsertLink = (event: KeyboardEvent): boolean => {
  const { code } = event;
  return code === "KeyK" && isModifierMatch(event, CONTROL_OR_META);
};

export const isAddComment = (event: KeyboardEvent): boolean => {
  const { code } = event;
  return (
    code === "KeyM" &&
    isModifierMatch(event, { ...CONTROL_OR_META, altKey: true })
  );
};
