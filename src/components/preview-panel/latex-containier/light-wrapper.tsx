import React, { FC, useEffect } from "react";
import { SourceCodeWrapper } from "./latex-container.style";

type LightWrapperProps = {
  children: React.ReactNode;
};

export const LightWrapper: FC<LightWrapperProps> = ({ children }) => {
  useEffect(() => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href =
      "https://cdn.jsdelivr.net/npm/prismjs@1.26.0/themes/prism.min.css";

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
