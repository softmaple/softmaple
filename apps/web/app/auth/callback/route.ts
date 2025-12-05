import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const next = requestUrl.searchParams.get("next") || "/";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    
    if (!error) {
      // Check if this is a password reset flow
      const { data, error: getUserError } = await supabase.auth.getUser();
      
      // Handle error or missing user
      if (getUserError || !data?.user) {
        console.error("Error fetching user after code exchange:", getUserError);
        return NextResponse.redirect(
          new URL("/login?error=Authentication failed", requestUrl.origin)
        );
      }
      
      // Now we can safely access the user
      const user = data.user;
      
      if (user.app_metadata?.provider === 'email' && 
          user.user_metadata?.email_change_token_current) {
        // This is a password reset flow
        return NextResponse.redirect(new URL("/reset-password/update", requestUrl.origin));
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
