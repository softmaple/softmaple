import type { PostgrestError } from "@supabase/supabase-js";
import type { ZodError } from "zod";

export const ACTION_ERROR_CODE = {
  AuthenticationRequired: "AUTHENTICATION_REQUIRED",
  Conflict: "CONFLICT",
  Forbidden: "FORBIDDEN",
  Internal: "INTERNAL",
  NotFound: "NOT_FOUND",
  Storage: "STORAGE",
  Validation: "VALIDATION",
} as const;

export type ActionErrorCode =
  (typeof ACTION_ERROR_CODE)[keyof typeof ACTION_ERROR_CODE];

export type ActionResult<T> =
  | { readonly ok: true; readonly data: T }
  | {
      readonly ok: false;
      readonly code: ActionErrorCode;
      readonly message: string;
      readonly fieldErrors?: Readonly<Record<string, string[]>>;
    };

export const actionSuccess = <T>(data: T): ActionResult<T> => ({
  ok: true,
  data,
});

export const actionFailure = (
  code: ActionErrorCode,
  message: string,
  fieldErrors?: Readonly<Record<string, string[]>>,
): ActionResult<never> => ({
  ok: false,
  code,
  message,
  ...(fieldErrors === undefined ? {} : { fieldErrors }),
});

export const fromZodError = (error: ZodError): ActionResult<never> =>
  actionFailure(
    ACTION_ERROR_CODE.Validation,
    "Check the highlighted fields and try again.",
    error.flatten().fieldErrors,
  );

const DATABASE_ERROR_DETAILS: Readonly<
  Record<string, { readonly code: ActionErrorCode; readonly message: string }>
> = {
  document_not_found: {
    code: ACTION_ERROR_CODE.NotFound,
    message: "Document not found.",
  },
  invalid_workspace_role: {
    code: ACTION_ERROR_CODE.Validation,
    message: "Choose Editor or Viewer.",
  },
  member_not_found_or_owner: {
    code: ACTION_ERROR_CODE.NotFound,
    message: "The member was not found or is the workspace owner.",
  },
  registered_user_not_found: {
    code: ACTION_ERROR_CODE.NotFound,
    message: "No registered Softmaple account uses that email address.",
  },
  workspace_access_denied: {
    code: ACTION_ERROR_CODE.Forbidden,
    message: "You do not have access to this workspace.",
  },
  workspace_member_exists: {
    code: ACTION_ERROR_CODE.Conflict,
    message: "That person is already a workspace member.",
  },
  workspace_owner_required: {
    code: ACTION_ERROR_CODE.Forbidden,
    message: "Only the workspace owner can do that.",
  },
};

export const fromDatabaseError = (
  error: Pick<PostgrestError, "code" | "message">,
  fallbackMessage: string,
): ActionResult<never> => {
  const known = DATABASE_ERROR_DETAILS[error.message];
  if (known !== undefined) return actionFailure(known.code, known.message);
  if (error.code === "42501") {
    return actionFailure(
      ACTION_ERROR_CODE.Forbidden,
      "You do not have permission to do that.",
    );
  }
  if (error.code === "P0002" || error.code === "PGRST116") {
    return actionFailure(
      ACTION_ERROR_CODE.NotFound,
      "The requested item was not found.",
    );
  }
  if (error.code === "23505" || error.code === "23503") {
    return actionFailure(
      ACTION_ERROR_CODE.Conflict,
      "That change conflicts with existing data.",
    );
  }
  if (error.code === "22023") {
    return actionFailure(
      ACTION_ERROR_CODE.Validation,
      "The supplied value is invalid.",
    );
  }
  return actionFailure(ACTION_ERROR_CODE.Internal, fallbackMessage);
};
