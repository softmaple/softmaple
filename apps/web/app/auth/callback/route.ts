import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const type = requestUrl.searchParams.get("type");
  const next = requestUrl.searchParams.get("next") || "/";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    
    if (!error) {
      // Check if this is a password recovery flow
      // Supabase sends type=recovery for password reset links
      if (type === "recovery") {
        // User clicked on password reset link - redirect to update password page
        return NextResponse.redirect(new URL("/reset-password/update", requestUrl.origin));
      }
      
      // For normal auth flow, verify user exists
      const { data, error: getUserError } = await supabase.auth.getUser();
      if (getUserError || !data?.user) {
        console.error("Error fetching user after code exchange:", getUserError);
        return NextResponse.redirect(
          new URL("/login?error=Authentication failed", requestUrl.origin)
        );
      }
      
      // Normal auth flow - user is authenticated successfully
      return NextResponse.redirect(new URL(next, requestUrl.origin));
    }
  }

  // Auth callback error
  return NextResponse.redirect(
    new URL("/login?error=Could not authenticate user", requestUrl.origin)
  );
}
