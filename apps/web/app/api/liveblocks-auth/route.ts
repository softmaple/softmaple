import { Liveblocks } from "@liveblocks/node";
import { getCurrentUser } from "@/app/actions/auth";
import { getWorkspaceMemberByUserId } from "@/app/actions/workspaceMembers";
import type { NextRequest } from "next/server";

const liveblocks = new Liveblocks({
  secret: process.env.LIVEBLOCKS_SECRET_KEY!,
});

export async function POST(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const workspaceId = searchParams.get("workspaceId");

  if (!workspaceId) {
    return new Response("Workspace ID is required", { status: 400 });
  }

  const workspaceIdNumber = Number(workspaceId);

  if (Number.isNaN(workspaceIdNumber) || workspaceIdNumber <= 0) {
    return new Response("Invalid Workspace ID", { status: 400 });
  }

  // Get the current user from your database
  const { data, error } = await getCurrentUser();
  if (error) {
    console.error("Error fetching current user:", error);
    return new Response("Unauthorized", { status: 401 });
  }

  const { user } = data || {};

  if (!user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { data: workspaceMember, error: wmError } =
    await getWorkspaceMemberByUserId(workspaceIdNumber);

  if (wmError) {
    console.error("Error fetching workspace member:", wmError);
    return new Response("Unauthorized", { status: 401 });
  }

  if (!workspaceMember) {
    return new Response("Unauthorized", { status: 401 });
  }

  // Identify the user and return the result
  const { status, body } = await liveblocks.identifyUser(
    {
      userId: user.id,
      groupIds: [workspaceMember.role], // Optional
    },
    { userInfo: user.user_metadata },
  );

  return new Response(body, { status });
}
