import type { FC, ReactNode } from "react";
import { ToolbarContext } from "@/components/core/context/ToolbarContext.tsx";

type ProvidersProps = {
  children: ReactNode;
};

export const Providers: FC<ProvidersProps> = ({ children }) => {
  return <ToolbarContext>{children}</ToolbarContext>;
};
