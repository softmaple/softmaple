import { type NextRequest, NextResponse } from "next/server";

import { createClient } from "@/utils/supabase/server";
import { redirect } from "next/navigation";
import { sanitizeRedirectUrl } from "@/utils/auth/sanitize-redirect";
import {
  AUTH_LINK_ERROR,
  authLinkErrorPath,
} from "@/modules/auth/auth-link-errors";

const VALID_EMAIL_OTP_TYPES = [
  "signup",
  "invite",
  "magiclink",
  "recovery",
  "email_change",
  "email",
] as const;

type ValidEmailOtpType = (typeof VALID_EMAIL_OTP_TYPES)[number];

function isValidEmailOtpType(value: string): value is ValidEmailOtpType {
  return VALID_EMAIL_OTP_TYPES.includes(value as ValidEmailOtpType);
}

/**
 * Email links built from `{{ .TokenHash }}` land here. The token is verified
 * on the server, so unlike a PKCE code the link works in any browser.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type");
  const nextParam = searchParams.get("next");
  // A reset link without `next` still ends on the new password form.
  const safeNext = sanitizeRedirectUrl(
    nextParam ?? (type === "recovery" ? "/reset-password/update" : null),
  );
  // Send people somewhere they can recover instead of a bare error body.
  const fail = () =>
    NextResponse.redirect(
      new URL(
        authLinkErrorPath(
          type === "recovery"
            ? AUTH_LINK_ERROR.ResetLinkInvalid
            : AUTH_LINK_ERROR.LinkInvalid,
        ),
        request.url,
      ),
    );

  if (!token_hash || !type || !isValidEmailOtpType(type)) {
    return fail();
  }

  const supabase = await createClient();

  const { error } = await supabase.auth.verifyOtp({ type, token_hash });

  if (error) {
    return fail();
  }

  // redirect user to specified redirect URL or root of app
  redirect(safeNext);
}
