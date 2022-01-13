import { FC, useEffect, useMemo } from "react";
import hljs from "highlight.js";
import latex from "highlight.js/lib/languages/latex";
import type { PaletteMode } from "@mui/material";
import { DarkWrapper } from "./dark-wrapper";
import { LightWrapper } from "./light-wrapper";

hljs.registerLanguage("latex", latex);

type LaTeXWrapperProps = {
  mode: PaletteMode;
  sourceCode: string;
};

export const LaTeXWrapper: FC<LaTeXWrapperProps> = ({ mode, sourceCode }) => {
  useEffect(() => {
    if (sourceCode || mode) {
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
