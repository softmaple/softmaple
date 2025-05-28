import {
  useCallback,
  useContext,
  useMemo,
  useState,
  createContext,
} from "react";
import type { ReactNode } from "react";
import { INITIAL_TOOLBAR_STATE } from "@softmaple/editor/constants/toolbar.ts";

export type ToolbarState = typeof INITIAL_TOOLBAR_STATE;

// Utility type to get keys and infer value types
type ToolbarStateKey = keyof ToolbarState;
type ToolbarStateValue<Key extends ToolbarStateKey> = ToolbarState[Key];

type ContextShape = {
  toolbarState: ToolbarState;
  updateToolbarState<Key extends ToolbarStateKey>(
    key: Key,
    value: ToolbarStateValue<Key>,
  ): void;
};

const Context = createContext<ContextShape | undefined>(undefined);

export const ToolbarContext = ({ children }: { children: ReactNode }) => {
  const [toolbarState, setToolbarState] = useState<ToolbarState>(
    INITIAL_TOOLBAR_STATE,
  );

  const updateToolbarState = useCallback(
    <Key extends ToolbarStateKey>(key: Key, value: ToolbarStateValue<Key>) => {
      setToolbarState((prev) => ({
        ...prev,
        [key]: value,
      }));
    },
    [],
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
