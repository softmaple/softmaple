import dynamic from "next/dynamic";
import Skeleton from "@mui/material/Skeleton";
import { styled } from "@mui/material";
import type { PaletteMode } from "@mui/material";
import { FC, useState } from "react";
import Paper from "@mui/material/Paper";
import Tooltip from "@mui/material/Tooltip";
import IconButton from "@mui/material/IconButton";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";

const LaTeXWrapper = dynamic(
  () => import("./latex-wrapper").then((mod) => mod.LaTeXWrapper),
  {
    loading: () => (
      <Skeleton variant="rectangular" width="100%" height="100%" />
    ),
  }
);

const SourceCodeContainer = styled(Paper)(({ theme }) => ({
  ...theme.typography.body2,
  color: theme.palette.text.secondary,
  position: "relative",
  overflowY: "auto",
}));

type LaTeXContainerProps = {
  mode: PaletteMode;
  sourceCode: string;
};

export const LaTeXContainer: FC<LaTeXContainerProps> = ({
  mode,
  sourceCode,
}) => {
  const [clipboardTitle, setClipboardTitle] = useState("Copy to clipboard");

  const copyToClipboard = async () => {
    await navigator.clipboard.writeText(sourceCode);
    setClipboardTitle("Copied!");
    setTimeout(() => {
      setClipboardTitle("Copy to clipboard");
    }, 1000);
  };

  return (
    <SourceCodeContainer elevation={24}>
      {sourceCode && (
        <>
          <Tooltip title={clipboardTitle} placement="top">
            <IconButton
              color="inherit"
              onClick={copyToClipboard}
              sx={{ position: "absolute", right: "0" }}
            >
              <ContentCopyIcon />
            </IconButton>
          </Tooltip>
          <LaTeXWrapper mode={mode} sourceCode={sourceCode} />
        </>
      )}
    </SourceCodeContainer>
  );
};
