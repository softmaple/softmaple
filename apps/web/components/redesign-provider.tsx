"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { RedesignFlags } from "@/lib/redesign-flags";
import { MotionPreference } from "@/components/collaboration-preferences";

const Context = createContext<RedesignFlags>({
  shell: false,
  presence: false,
  attention: false,
  field: false,
});

export function RedesignProvider({
  flags,
  children,
}: {
  readonly flags: RedesignFlags;
  readonly children: ReactNode;
}) {
  return (
    <Context.Provider value={flags}>
      <MotionPreference />
      {children}
    </Context.Provider>
  );
}

export const useRedesignFlags = () => useContext(Context);
