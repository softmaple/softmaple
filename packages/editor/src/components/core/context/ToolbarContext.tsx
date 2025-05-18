import type { ReactNode } from "react";
import { createContext } from "react";

const Context = createContext<unknown>(undefined);

export const ToolbarContext = ({ children }: { children: ReactNode }) => {
  const contextValue = {};

  return <Context value={contextValue}>{children}</Context>;
};
