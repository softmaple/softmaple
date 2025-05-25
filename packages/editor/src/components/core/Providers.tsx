import type { FC, ReactNode } from "react";
import { ToolbarContext } from "@/context/ToolbarContext.tsx";
import { SharedHistoryContext } from "@/context/SharedHistoryContext.tsx";

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
