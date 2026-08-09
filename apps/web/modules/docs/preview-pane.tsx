"use client";

import type { FC } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export const PreviewPane: FC<{ readonly markdown: string }> = ({
  markdown,
}) => (
  <article className="markdown-preview mx-auto max-w-3xl px-5 py-10 sm:px-8">
    <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>
      {markdown}
    </ReactMarkdown>
  </article>
);
