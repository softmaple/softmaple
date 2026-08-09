"use client";

import type { ReactNode } from "react";
import { EditorStateProvider } from "@/contexts/EditorStateContext";

export default function SharedDocumentLayout({
  children,
}: {
  readonly children: ReactNode;
}) {
  return <EditorStateProvider>{children}</EditorStateProvider>;
}
