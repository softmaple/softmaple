"use client";

import type { FC } from "react";
import { markdownToLatex } from "@softmaple/md2latex";

export const LatexPane: FC<{
  readonly markdown: string;
  readonly title: string;
}> = ({ markdown, title }) => (
  <pre className="mx-auto min-h-full max-w-4xl whitespace-pre-wrap break-words px-5 py-8 font-mono text-xs leading-6 sm:px-8">
    {markdownToLatex(markdown, { title })}
  </pre>
);
