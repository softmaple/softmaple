import { FC, useEffect } from "react";
import hljs from "highlight.js";
import latex from "highlight.js/lib/languages/latex";
import type { PaletteMode } from "@mui/material";
import { DarkWrapper } from "./dark-wrapper";
import { LightWrapper } from "./light-wrapper";
import { usePrevious } from "@/hooks/use-previous";

hljs.registerLanguage("latex", latex);

type LaTeXWrapperProps = {
  mode: PaletteMode;
  sourceCode: string;
};

export const LaTeXWrapper: FC<LaTeXWrapperProps> = ({ mode, sourceCode }) => {
  const prevMode = usePrevious(mode);

  useEffect(() => {
    if (sourceCode || prevMode !== mode) {
      hljs.highlightAll();
    }
  }, [sourceCode, mode, prevMode]);

  const code = (
    <code
      style={{ height: "100%", cursor: "default" }}
      className="language-latex"
    >
      {sourceCode}
    </code>
  );

  return mode === "light" ? (
    <LightWrapper>{code}</LightWrapper>
  ) : (
    <DarkWrapper>{code}</DarkWrapper>
  );
};
