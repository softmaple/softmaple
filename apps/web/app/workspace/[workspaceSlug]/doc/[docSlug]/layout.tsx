import type { ReactNode } from "react";
import { EditorStateProvider } from "@/contexts/EditorStateContext";

export default function DocLayoutPage({ children }: { children: ReactNode }) {
  return <EditorStateProvider>{children}</EditorStateProvider>;
}
