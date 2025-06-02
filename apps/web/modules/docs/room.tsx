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
      authEndpoint={async (room) => {
        const response = await fetch("/api/liveblocks-auth", {
          method: "POST",
          // headers: {
          //   Authentication: "<your own headers here>",
          //   "Content-Type": "application/json",
          // },
          body: JSON.stringify({ room, workspaceId }),
        });
        return await response.json();
      }}
    >
      <RoomProvider id={roomId}>
        <ClientSideSuspense fallback={<div>Loading…</div>}>
          {children}
        </ClientSideSuspense>
      </RoomProvider>
    </LiveblocksProvider>
  );
};
