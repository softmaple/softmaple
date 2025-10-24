import type { HistoryState } from "@lexical/react/LexicalHistoryPlugin";

import { createEmptyHistoryState } from "@lexical/react/LexicalHistoryPlugin";
import type { ReactNode, JSX, Context } from "react";
import { createContext, useContext, useMemo } from "react";

type ContextShape = {
  historyState?: HistoryState;
};

const Context: Context<ContextShape> = createContext({});

export const SharedHistoryContext = ({
  children,
}: {
  children: ReactNode;
}): JSX.Element => {
  const historyContext = useMemo(
    () => ({ historyState: createEmptyHistoryState() }),
    [],
  );
  return <Context value={historyContext}>{children}</Context>;
};

export const useSharedHistoryContext = (): ContextShape => {
  return useContext(Context);
};
