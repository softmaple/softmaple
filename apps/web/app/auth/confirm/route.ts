import { type NextRequest } from "next/server";

import { createClient } from "@/utils/supabase/server";
import { redirect } from "next/navigation";
import { type EmailOtpType } from "@supabase/supabase-js";

/**
 * Sanitizes the redirect URL to prevent open redirects.
 * Only allows internal paths that start with a single "/"
 * @param url - The URL to sanitize
 * @returns A safe internal path or "/" as fallback
 */
function sanitizeRedirectUrl(url: string | null): string {
  if (!url) {
    return "/";
  }

  // Remove any whitespace
  const trimmed = url.trim();

  // Check if it starts with a single "/" and not "//" (protocol-relative URL)
  // Also ensure it doesn't contain a protocol or full origin
  if (
    trimmed.startsWith("/") &&
    !trimmed.startsWith("//") &&
    !trimmed.includes(":") &&
    !trimmed.includes("@")
  ) {
    // Additional check: ensure no URL encoding tricks
    try {
      const decoded = decodeURIComponent(trimmed);
      // Re-check after decoding
      if (
        decoded.startsWith("/") &&
        !decoded.startsWith("//") &&
        !decoded.includes(":") &&
        !decoded.includes("@")
      ) {
        return trimmed;
      }
    } catch {
      // If decoding fails, reject it
      return "/";
    }
  }

  return "/";
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType;
  const nextParam = searchParams.get("next");
  const safeNext = sanitizeRedirectUrl(nextParam);

  // Throw error early if required parameters are missing
  if (!token_hash || !type) {
    throw new Error(
      "Invalid request parameters. Please provide a valid token_hash and type.",
    );
  }

  const supabase = await createClient();

  const { error } = await supabase.auth.verifyOtp({
    type,
    token_hash,
  });
  
  if (error) {
    // redirect the user to an error page with some instructions
    throw error;
  }

  // redirect user to specified redirect URL or root of app
  redirect(safeNext);
}
