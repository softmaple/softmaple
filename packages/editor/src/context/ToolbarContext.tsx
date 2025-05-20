import {
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import { createContext } from "react";

export const blockTypeToBlockName = {
  bullet: "Bulleted List",
  check: "Check List",
  code: "Code Block",
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

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const rootTypeToRootName = {
  root: "Root",
  table: "Table",
};

const INITIAL_TOOLBAR_STATE = {
  canRedo: false,
  canUndo: false,
  blockType: "paragraph" as keyof typeof blockTypeToBlockName,
  isBold: false,
  isItalic: false,
  isUnderline: false,
  isStrikethrough: false,
  rootType: "root" as keyof typeof rootTypeToRootName,
};

type ToolbarState = typeof INITIAL_TOOLBAR_STATE;

// Utility type to get keys and infer value types
type ToolbarStateKey = keyof ToolbarState;
type ToolbarStateValue<Key extends ToolbarStateKey> = ToolbarState[Key];

type ContextShape = {
  toolbarState: ToolbarState;
  updateToolbarState<Key extends ToolbarStateKey>(
    key: Key,
    value: ToolbarStateValue<Key>
  ): void;
};

const Context = createContext<ContextShape | undefined>(undefined);

export const ToolbarContext = ({ children }: { children: ReactNode }) => {
  const [toolbarState, setToolbarState] = useState<ToolbarState>(
    INITIAL_TOOLBAR_STATE
  );

  const updateToolbarState = useCallback(
    <Key extends ToolbarStateKey>(key: Key, value: ToolbarStateValue<Key>) => {
      setToolbarState((prev) => ({
        ...prev,
        [key]: value,
      }));
    },
    []
  );

  const contextValue = useMemo(() => {
    return {
      toolbarState,
      updateToolbarState,
    };
  }, [toolbarState, updateToolbarState]);

  return <Context value={contextValue}>{children}</Context>;
};

export const useToolbarState = () => {
  const context = useContext(Context);

  if (!context) {
    throw new Error("useToolbarState must be used within a ToolbarProvider");
  }

  return context;
};
