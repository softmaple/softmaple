import React, { FC, useEffect } from "react";
import { SourceCodeWrapper } from "./latex-container.style";

type DarkWrapperProps = {
  children: React.ReactNode;
};

export const DarkWrapper: FC<DarkWrapperProps> = ({ children }) => {
  useEffect(() => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href =
      "https://cdn.jsdelivr.net/npm/prismjs@1.26.0/themes/prism-dark.min.css";

    document.head.appendChild(link);

    return () => {
      document.head.removeChild(link);
    };
  }, []);

  return (
    <div>
      <SourceCodeWrapper>{children}</SourceCodeWrapper>
    </div>
  );
};
