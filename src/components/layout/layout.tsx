import { FC, useMemo } from "react";
import type { PaletteMode } from "@mui/material";
import { createTheme, ThemeProvider } from "@mui/material/styles";
import CssBaseline from "@mui/material/CssBaseline";

type LayoutProps = {
  mode: PaletteMode;
  children: React.ReactNode;
};

export const Layout: FC<LayoutProps> = ({ mode, children }) => {
  const theme = useMemo(
    () =>
      createTheme({
        palette: {
          mode,
        },
      }),
    [mode]
  );

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      {children}
    </ThemeProvider>
  );
};
