import type { FC, ReactNode } from "react";
import { ToolbarContext } from "@/context/ToolbarContext.tsx";

type ProvidersProps = {
  children: ReactNode;
};

export const Providers: FC<ProvidersProps> = ({ children }) => {
  return <ToolbarContext>{children}</ToolbarContext>;
};
