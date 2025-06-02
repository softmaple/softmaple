"use client";

import type { FC } from "react";
import {
  FloatingToolbar,
  liveblocksConfig,
  LiveblocksPlugin,
} from "@liveblocks/react-lexical";
import { Threads } from "@/modules/docs/threads";
import { CoreEditor } from "@softmaple/editor/components/core/CoreEditor";
import { LEXIAL_PLAYGROUND_CONFIG } from "@softmaple/editor/config/lexical";
import type { InitialConfigType } from "@lexical/react/LexicalComposer";

import "@liveblocks/react-ui/styles.css";
import "@liveblocks/react-lexical/styles.css";

export type CollabDocEditorProps = {
  commonEditorConfig?: InitialConfigType;
};

export const CollabDocEditor: FC<CollabDocEditorProps> = (props) => {
  const { commonEditorConfig } = props;

  const lexicalConfig: InitialConfigType = liveblocksConfig({
    ...LEXIAL_PLAYGROUND_CONFIG,
    ...commonEditorConfig,
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
