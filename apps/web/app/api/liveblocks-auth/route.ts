import { Liveblocks } from "@liveblocks/node";
import { createClient } from "@/utils/supabase/server";

const liveblocks = new Liveblocks({
  secret: process.env.LIVEBLOCKS_SECRET_KEY || "sk_dev_placeholder",
});

export async function POST(request: Request) {
  // Get the current user from your database
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return new Response("Unauthorized", { status: 401 });
  }

  // Identify the user and return the result
  const { status, body } = await liveblocks.identifyUser(
    {
      userId: user.id,
      groupIds: [], // Optional
    },
    { userInfo: user.user_metadata },
  );

  return new Response(body, { status });
}
