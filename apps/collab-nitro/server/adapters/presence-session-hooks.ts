import { COLLAB_ACCESS_MODE } from "@softmaple/collab-protocol";
import type {
  PresenceIdentity,
  PresenceSessionHooks,
} from "@softmaple/collab-runtime";
import { authorizeDocument } from "../utils/auth";
import { prisma } from "../utils/prisma";

const resolveIdentity = async (
  credential: Parameters<typeof authorizeDocument>[0],
  roomId: string,
  claimedUserId: string,
): Promise<PresenceIdentity | null> => {
  const access = await authorizeDocument(credential, roomId);
  if (
    access === null ||
    access.accessMode !== COLLAB_ACCESS_MODE.Authenticated ||
    access.userId !== claimedUserId
  ) {
    return null;
  }
  const profile = await prisma.user.findUnique({
    where: { id: access.userId },
    select: { avatar_src: true, full_name: true },
  });
  if (profile === null) return null;
  return {
    name: profile.full_name?.trim() || "Workspace member",
    userId: access.userId,
    ...(profile.avatar_src === null ? {} : { avatarUrl: profile.avatar_src }),
  };
};

/**
 * Supabase + Prisma authorization presented as runtime-neutral presence
 * session hooks. Presence is authenticated-only. Name/avatar are always
 * DB-authoritative — never derived from a client-supplied wire payload.
 */
export const presenceSessionHooks: PresenceSessionHooks = {
  async authorize(request) {
    return resolveIdentity(request.credential, request.roomId, request.userId);
  },

  async refresh(request) {
    return resolveIdentity(
      request.credential,
      request.session.roomId,
      request.session.identity.userId,
    );
  },
};
