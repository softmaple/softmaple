"use client";

import { useThreads } from "@liveblocks/react/suspense";
import {
  AnchoredThreads,
  FloatingComposer,
  FloatingThreads,
} from "@liveblocks/react-lexical";

export function Threads() {
  const { threads } = useThreads();

  return (
    <>
      {/* Hidden on mobile, visible on desktop */}
      <div className="hidden sm:block absolute right-1 w-full max-w-[300px]">
        <AnchoredThreads threads={threads} />
      </div>

      {/* Visible on mobile, hidden on desktop */}
      <FloatingThreads className="block sm:hidden" threads={threads} />
      <FloatingComposer className="floating-composer" />
    </>
  );
}
