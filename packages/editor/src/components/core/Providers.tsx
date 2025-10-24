import type { FC, ReactNode } from "react";
import { ToolbarContext } from "@softmaple/editor/context/ToolbarContext";
import { SharedHistoryContext } from "@softmaple/editor/context/SharedHistoryContext";

type ProvidersProps = {
  children: ReactNode;
};

export const Providers: FC<ProvidersProps> = ({ children }) => {
  return (
    <SharedHistoryContext>
      <ToolbarContext>{children}</ToolbarContext>
    </SharedHistoryContext>
  );
};
