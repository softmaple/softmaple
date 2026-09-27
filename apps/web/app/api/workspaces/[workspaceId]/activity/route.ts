import { loadWorkspaceWritingActivity } from "@/app/actions/workspaceActivity";
import { ACTION_ERROR_CODE, type ActionErrorCode } from "@/lib/actions/result";

type Context = { readonly params: Promise<{ workspaceId: string }> };

const STATUS_BY_ERROR = {
  [ACTION_ERROR_CODE.AuthenticationRequired]: 401,
  [ACTION_ERROR_CODE.Conflict]: 409,
  [ACTION_ERROR_CODE.Forbidden]: 403,
  [ACTION_ERROR_CODE.Internal]: 500,
  [ACTION_ERROR_CODE.NotFound]: 404,
  [ACTION_ERROR_CODE.Storage]: 500,
  [ACTION_ERROR_CODE.Validation]: 400,
} as const satisfies Record<ActionErrorCode, number>;

// Per-member activity: never let a browser or shared cache reuse it.
const NO_STORE = { "Cache-Control": "private, no-store" } as const;

/** Polled by a visible workspace home to keep "Happening now" current. */
export async function GET(_request: Request, { params }: Context) {
  const { workspaceId } = await params;
  const result = await loadWorkspaceWritingActivity(
    /^[1-9]\d{0,9}$/.test(workspaceId) ? Number(workspaceId) : Number.NaN,
  );
  if (!result.ok) {
    return Response.json(
      { code: result.code, message: result.message },
      { headers: NO_STORE, status: STATUS_BY_ERROR[result.code] },
    );
  }
  return Response.json(result.data, { headers: NO_STORE });
}
