"use server";

import { Liveblocks } from "@liveblocks/node";
import { WorkspaceMemberRole } from "@softmaple/db";

const liveblocks = new Liveblocks({
  secret: process.env.LIVEBLOCKS_SECRET_KEY!,
});

export const createLiveblocksRoom = async (roomId: string) => {
  try {
    if (!roomId || typeof roomId !== "string") {
      throw new Error(`Invalid room ID: ${roomId}`);
    }

    const room = await liveblocks.createRoom(roomId, {
      defaultAccesses: [],
      groupsAccesses: {
        [WorkspaceMemberRole["OWNER"]]: ["room:write"],
        [WorkspaceMemberRole["EDITOR"]]: ["room:read", "room:presence:write"],
        // NOTE: workspace members with VIEWER role can only read the doc instead of room
      },
    });

    return room;
  } catch (error) {
    console.error("Error creating Liveblocks room:", error);
    throw error;
  }
};

export const getLiveblocksRoom = async (roomId: string) => {
  try {
    if (!roomId || typeof roomId !== "string") {
      throw new Error(`Invalid room ID: ${roomId}`);
    }

    const room = await liveblocks.getRoom(roomId);

    if (!room) {
      throw new Error(`Room with ID ${roomId} does not exist.`);
    }

    return room;
  } catch (error) {
    console.error("Error fetching Liveblocks room:", error);
    throw error;
  }
};

export const deleteLiveblocksRoom = async (roomId: string) => {
  try {
    if (!roomId || typeof roomId !== "string") {
      throw new Error(`Invalid room ID: ${roomId}`);
    }

    await liveblocks.deleteRoom(roomId);
  } catch (error) {
    console.error("Error deleting Liveblocks room:", error);
    throw error;
  }
};
