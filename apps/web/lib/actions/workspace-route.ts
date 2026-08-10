import { notFound, redirect } from "next/navigation";
import {
  ACTION_ERROR_CODE,
  type ActionErrorCode,
  type ActionResult,
} from "@/lib/actions/result";

export type WorkspaceRouteFailureContext = {
  readonly loginNext: string;
  readonly operation: string;
  readonly route: string;
  readonly workspaceSlug: string;
};

const logWorkspaceRouteFailure = (
  level: "error" | "warn",
  context: WorkspaceRouteFailureContext,
  code: ActionErrorCode,
  message: string,
): void => {
  const payload = {
    code,
    message,
    operation: context.operation,
    route: context.route,
    workspaceSlug: context.workspaceSlug,
  };
  if (level === "error") {
    console.error("[workspace-route]", payload);
    return;
  }
  console.warn("[workspace-route]", payload);
};

/**
 * Maps a failed workspace ActionResult to HTTP/route behavior.
 *
 * - Missing or inaccessible resources → notFound() (resource hiding)
 * - Missing/expired auth → login redirect
 * - Internal/validation/conflict/storage → throw for the nearest error boundary
 */
export const settleWorkspaceRouteFailure = (
  result: Extract<ActionResult<unknown>, { readonly ok: false }>,
  context: WorkspaceRouteFailureContext,
): never => {
  if (result.code === ACTION_ERROR_CODE.NotFound) {
    notFound();
  }

  if (result.code === ACTION_ERROR_CODE.Forbidden) {
    logWorkspaceRouteFailure("warn", context, result.code, result.message);
    notFound();
  }

  if (result.code === ACTION_ERROR_CODE.AuthenticationRequired) {
    redirect(`/login?next=${encodeURIComponent(context.loginNext)}`);
  }

  logWorkspaceRouteFailure("error", context, result.code, result.message);
  throw new Error(
    `${context.operation} failed (${result.code}): ${result.message}`,
  );
};

export const requireWorkspaceRouteData = <T>(
  result: ActionResult<T>,
  context: WorkspaceRouteFailureContext,
): T => {
  if (result.ok) return result.data;
  return settleWorkspaceRouteFailure(result, context);
};
