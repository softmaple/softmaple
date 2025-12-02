import { type EmailOtpType } from "@supabase/supabase-js";
import { type NextRequest } from "next/server";

import { createClient } from "@/utils/supabase/server";
import { redirect } from "next/navigation";

// When using token_hash, the type should be one of these
type TokenHashType = "recovery" | "invite" | "signup" | "email_change" | "email";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get("token");
  const type = searchParams.get("type") as TokenHashType | null;
  const next = searchParams.get("next") ?? "/";

  if (token && type) {
    const supabase = await createClient();

    const { error } = await supabase.auth.verifyOtp({
      type: type as EmailOtpType,
      token_hash: token,
    });
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
