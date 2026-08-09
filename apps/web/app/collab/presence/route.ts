import type { NextRequest } from "next/server";
import { handleCollabWebSocketBridge } from "@/lib/collab-ws-bridge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Keep presence sockets alive within Fluid Compute limits. */
export const maxDuration = 800;

export const GET = (request: NextRequest): Promise<Response> =>
  handleCollabWebSocketBridge(request, "/collab/presence");
