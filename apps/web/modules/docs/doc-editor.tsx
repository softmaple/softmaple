"use client";

import type { FC } from "react";
import { CoreEditor } from "@softmaple/editor/components/core/CoreEditor";
import {
  FloatingToolbar,
  liveblocksConfig,
  LiveblocksPlugin,
} from "@liveblocks/react-lexical";
import { LEXIAL_PLAYGROUND_CONFIG } from "@softmaple/editor/config/lexical";
import { Threads } from "@/modules/docs/threads";

import "@liveblocks/react-ui/styles.css";
import "@liveblocks/react-lexical/styles.css";

export type DocEditorProps = {};

export const DocEditor: FC<DocEditorProps> = (props) => {
  const lexicalConfig = liveblocksConfig({
    ...LEXIAL_PLAYGROUND_CONFIG,
    namespace: "DocEditor",
    onError: (error: unknown) => {
      console.error(error);
      throw error;
    },
  });

  return (
    <CoreEditor lexicalConfig={lexicalConfig}>
      <LiveblocksPlugin>
        <Threads />
        <FloatingToolbar />
      </LiveblocksPlugin>
    </CoreEditor>
  );
};
