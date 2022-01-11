import { Dispatch, FC, SetStateAction } from "react";
import type { PaletteMode } from "@mui/material";
import IconButton from "@mui/material/IconButton";
import Brightness4Icon from "@mui/icons-material/Brightness4";
import Brightness7Icon from "@mui/icons-material/Brightness7";

type PaletteProps = {
  mode: PaletteMode;
  setMode: Dispatch<SetStateAction<PaletteMode>>;
};

export const Palette: FC<PaletteProps> = ({ mode, setMode }) => {
  const switchMode = () => {
    setMode((prevMode: PaletteMode) =>
      prevMode === "light" ? "dark" : "light"
    );
  };

  return (
    <IconButton
      color="inherit"
      sx={{ ml: 1 }}
      aria-label="switch palette"
      onClick={switchMode}
    >
      {mode === "dark" ? (
        <Brightness7Icon fontSize="large" />
      ) : (
        <Brightness4Icon fontSize="large" />
      )}
    </IconButton>
  );
};
