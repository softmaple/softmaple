import Link from "next/link";
import { SignupForm } from "@/modules/auth/signup-form";
import { AuthGuard } from "@/modules/auth/auth-guard";
import { AuthShell } from "@/modules/auth/auth-shell";
import { AuthOAuthOptions } from "@/modules/auth/auth-oauth-options";

export default function SignupPage() {
  return (
    <AuthGuard>
      <AuthShell
        artTitle={
          <>
            Good ideas start <span className="auth-brush">with you.</span>
          </>
        }
        description="Make room for your next good idea."
        title="Create your account"
      >
        <AuthOAuthOptions mode="sign-up" />
        <SignupForm />

        <p className="mt-5 text-xs leading-5 text-[#777973]">
          By continuing, you agree to our{" "}
          <Link
            className="underline underline-offset-4 hover:text-[#8a6d00]"
            href="/terms"
          >
            Terms
          </Link>{" "}
          and{" "}
          <Link
            className="underline underline-offset-4 hover:text-[#8a6d00]"
            href="/privacy"
          >
            Privacy Policy
          </Link>
          .
        </p>

        <p className="mt-7 text-center text-sm text-[#676963]">
          Already have an account?{" "}
          <Link
            className="text-[#8a6d00] underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#967200]"
            href="/login"
          >
            Log in
          </Link>
        </p>
      </AuthShell>
    </AuthGuard>
  );
}
