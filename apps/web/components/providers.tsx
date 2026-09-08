"use client";

import type { ComponentProps, ReactNode } from "react";
import { ThemeProvider as NextThemesProvider } from "next-themes";
import { PreferencesProvider } from "@/components/shell/preferences";

export function Providers({
  children,
  ...props
}: ComponentProps<typeof NextThemesProvider> & { children: ReactNode }) {
  return (
    <NextThemesProvider {...props}>
      <PreferencesProvider>{children}</PreferencesProvider>
    </NextThemesProvider>
  );
}
