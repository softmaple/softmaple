import { authLinkClass } from "@/modules/auth/auth-styles";
import Link from "next/link";
import { SignupForm } from "@/modules/auth/signup-form";
import { AuthGuard } from "@/modules/auth/auth-guard";
import { AuthPageShell } from "@/modules/auth/auth-page-shell";
import { AuthOAuthOptions } from "@/modules/auth/auth-oauth-options";

export default function SignupPage() {
  return (
    <AuthGuard>
      <AuthPageShell
        mode="signup"
        description="Make room for your next good idea."
        title="Create your account"
      >
        <SignupForm />
        <AuthOAuthOptions />

        <p className="mt-6 text-center text-sm text-(--muted-ink)">
          Already have an account?{" "}
          <Link className={authLinkClass} href="/login">
            Log in
          </Link>
        </p>
      </AuthPageShell>
    </AuthGuard>
  );
}
