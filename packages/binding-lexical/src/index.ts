export {
  createLexicalBinding,
  type LexicalBinding,
  type LexicalBindingOptions,
  type StableBlockSelection,
} from "./binding";
export { UnsupportedLexicalNodeError } from "./errors";
export {
  captureLogicalSelection,
  restoreLogicalSelection,
  type LogicalSelection,
  type LogicalSelectionPoint,
} from "./lexical-selection";
export type { LexicalBlockIndex } from "./projection-to-lexical";
