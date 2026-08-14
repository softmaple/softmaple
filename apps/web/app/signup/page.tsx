import Link from "next/link";
import { SignupForm } from "@/modules/auth/signup-form";
import { AuthGuard } from "@/modules/auth/auth-guard";
import { AuthShell } from "@/modules/auth/auth-shell";
import { AuthOAuthOptions } from "@/modules/auth/auth-oauth-options";

export default function SignupPage() {
  return (
    <AuthGuard>
      <AuthShell
        description="Start writing with Softmaple today"
        title="Create your account"
      >
        <SignupForm />
        <AuthOAuthOptions mode="sign-up" />

        <p className="mt-6 text-center text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link
            className="text-primary underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            href="/login"
          >
            Sign in
          </Link>
        </p>
      </AuthShell>
    </AuthGuard>
  );
}
