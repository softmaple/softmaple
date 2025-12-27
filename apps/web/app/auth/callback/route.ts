import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { sanitizeRedirectUrl } from "@/utils/auth/sanitize-redirect";

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const type = requestUrl.searchParams.get("type");
  const rawNext = requestUrl.searchParams.get("next");
  const next = sanitizeRedirectUrl(rawNext);

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (error) {
      console.error("Error exchanging code for session:", error);
      return NextResponse.redirect(
        new URL(
          `/login?error=${encodeURIComponent(error.message || "Could not authenticate user")}`,
          requestUrl.origin,
        ),
      );
    }

    // Code exchange successful
    // Check if this is a password recovery flow
    // Supabase sends type=recovery for password reset links
    if (type === "recovery") {
      // User clicked on password reset link - redirect to update password page
      return NextResponse.redirect(
        new URL("/reset-password/update", requestUrl.origin),
      );
    }

    // For normal auth flow, verify user exists
    const { data, error: getUserError } = await supabase.auth.getUser();
    if (getUserError || !data?.user) {
      console.error("Error fetching user after code exchange:", getUserError);
      return NextResponse.redirect(
        new URL("/login?error=Authentication failed", requestUrl.origin),
      );
    }

    // Normal auth flow - user is authenticated successfully
    // Use sanitized next URL to prevent open redirect attacks
    return NextResponse.redirect(new URL(next, requestUrl.origin));
  }

  // Auth callback error
  return NextResponse.redirect(
    new URL("/login?error=Could not authenticate user", requestUrl.origin),
  );
}
