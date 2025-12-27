import { type NextRequest, NextResponse } from "next/server";

import { createClient } from "@/utils/supabase/server";
import { redirect } from "next/navigation";
import { type EmailOtpType } from "@supabase/supabase-js";
import { sanitizeRedirectUrl } from "@/utils/auth/sanitize-redirect";

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

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type");
  const nextParam = searchParams.get("next");
  const safeNext = sanitizeRedirectUrl(nextParam);

  // Return 400 error for missing parameters
  if (!token_hash || !type) {
    return NextResponse.json(
      {
        error:
          "Invalid request parameters. Please provide a valid token_hash and type.",
      },
      { status: 400 },
    );
  }

  // Validate that type is a valid EmailOtpType
  if (!type || !isValidEmailOtpType(type)) {
    return NextResponse.json(
      { error: "Invalid type parameter. Must be a valid EmailOtpType." },
      { status: 400 },
    );
  }

  const supabase = await createClient();

  const { error } = await supabase.auth.verifyOtp({
    type: type as EmailOtpType,
    token_hash,
  });

  if (error) {
    // Return error response instead of throwing
    return NextResponse.json(
      { error: error.message },
      { status: error.status || 400 },
    );
  }

  // redirect user to specified redirect URL or root of app
  redirect(safeNext);
}
