import { FC, useEffect, useMemo } from "react";
import type { PaletteMode } from "@mui/material";
import { DarkWrapper } from "./dark-wrapper";
import { LightWrapper } from "./light-wrapper";

type LaTeXWrapperProps = {
  mode: PaletteMode;
  sourceCode: string;
};

export const LaTeXWrapper: FC<LaTeXWrapperProps> = ({ mode, sourceCode }) => {
  useEffect(() => {
    if (sourceCode || mode) {
      // @ts-ignore use CDN instead.
      hljs.highlightAll();
    }
  }, [sourceCode, mode]);

  const code = useMemo(
    () => (
      <code
        style={{ height: "100%", cursor: "default" }}
        className="language-latex"
      >
        {sourceCode}
      </code>
    ),
    [sourceCode]
  );

  return mode === "light" ? (
    <LightWrapper>{code}</LightWrapper>
  ) : (
    <DarkWrapper>{code}</DarkWrapper>
  );
};
