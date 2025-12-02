import { type EmailOtpType } from "@supabase/supabase-js";
import { type NextRequest } from "next/server";

import { createClient } from "@/utils/supabase/server";
import { redirect } from "next/navigation";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get("token");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = searchParams.get("next") ?? "/";
  const email = searchParams.get("email");

  if (token && type) {
    const supabase = await createClient();

    // For email verification with token (not token_hash)
    const { error } = await supabase.auth.verifyOtp({
      type,
      token,
      email: email || undefined,
    } as any);
    
    if (!error) {
      // redirect user to specified redirect URL or root of app
      redirect(next);
    }

    // redirect the user to an error page with some instructions
    throw error;
  }

  // redirect the user to an error page with some instructions
  throw new Error(
    "Invalid request parameters. Please provide a valid token and type.",
  );
}
