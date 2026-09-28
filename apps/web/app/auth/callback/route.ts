import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { sanitizeRedirectUrl } from "@/utils/auth/sanitize-redirect";
import {
  AUTH_LINK_ERROR,
  authLinkErrorPath,
  type AuthLinkError,
} from "@/modules/auth/auth-link-errors";

/**
 * PKCE keeps its code verifier in a cookie of the browser that asked for the
 * link, so a link opened anywhere else fails before reaching Supabase.
 */
const PKCE_VERIFIER_MISSING = "pkce_code_verifier_not_found";

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  // Password reset links carry type=recovery in the redirectTo we send.
  const isRecovery = requestUrl.searchParams.get("type") === "recovery";
  const next = sanitizeRedirectUrl(requestUrl.searchParams.get("next"));
  const redirectTo = (path: string) =>
    NextResponse.redirect(new URL(path, requestUrl.origin));
  const fail = (error: AuthLinkError) => redirectTo(authLinkErrorPath(error));

  // Supabase sends expired or already-used links back without a code.
  if (!code) {
    return fail(
      isRecovery
        ? AUTH_LINK_ERROR.ResetLinkInvalid
        : AUTH_LINK_ERROR.SignInFailed,
    );
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    console.error("Error exchanging code for session:", error);
    if (!isRecovery) return fail(AUTH_LINK_ERROR.SignInFailed);
    return fail(
      error.code === PKCE_VERIFIER_MISSING
        ? AUTH_LINK_ERROR.ResetLinkOtherBrowser
        : AUTH_LINK_ERROR.ResetLinkInvalid,
    );
  }

  if (isRecovery) {
    return redirectTo("/reset-password/update");
  }

  // For normal auth flow, verify user exists
  const { data, error: getUserError } = await supabase.auth.getUser();
  if (getUserError || !data?.user) {
    console.error("Error fetching user after code exchange:", getUserError);
    return fail(AUTH_LINK_ERROR.SignInFailed);
  }

  // Use sanitized next URL to prevent open redirect attacks
  return redirectTo(next);
}
