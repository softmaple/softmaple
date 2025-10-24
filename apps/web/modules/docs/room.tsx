"use client";

import type { ReactNode, FC } from "react";
import {
  LiveblocksProvider,
  RoomProvider,
  ClientSideSuspense,
} from "@liveblocks/react/suspense";

export type RoomProps = {
  roomId: string;
  workspaceId: number;
  children: ReactNode;
};

export const Room: FC<RoomProps> = (props) => {
  const { roomId, workspaceId, children } = props;

  return (
    <LiveblocksProvider
      authEndpoint={`/api/liveblocks-auth?workspaceId=${workspaceId}`}
    >
      <RoomProvider id={roomId}>
        <ClientSideSuspense fallback={<div>Loading…</div>}>
          {children}
        </ClientSideSuspense>
      </RoomProvider>
    </LiveblocksProvider>
  );
};
