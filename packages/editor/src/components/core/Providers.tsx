import type { FC, ReactNode } from "react";

type ProvidersProps = {
  children: ReactNode;
};

export const Providers: FC<ProvidersProps> = ({ children }) => {
  return <>{children}</>;
};
