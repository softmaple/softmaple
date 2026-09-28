import { authLinkClass } from "@/modules/auth/auth-styles";
import Link from "next/link";
import { LoginForm } from "@/modules/auth/login-form";
import { AuthGuard } from "@/modules/auth/auth-guard";
import { AuthPageShell } from "@/modules/auth/auth-page-shell";
import { AuthOAuthOptions } from "@/modules/auth/auth-oauth-options";
import { AuthNotice } from "@/modules/auth/auth-notice";
import { authLinkErrorMessage } from "@/modules/auth/auth-link-errors";

interface LoginPageProps {
  searchParams: Promise<{ error?: string; message?: string; next?: string }>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const message = params.message;
  const error = authLinkErrorMessage(params.error);

  return (
    <AuthGuard>
      <AuthPageShell
        mode="login"
        description="Pick up where your ideas left off."
        title="Welcome back"
      >
        {message === undefined ? null : (
          <AuthNotice className="mb-5">{message}</AuthNotice>
        )}
        {error === undefined ? null : (
          <AuthNotice className="mb-5" tone="error">
            {error}
          </AuthNotice>
        )}

        <LoginForm next={params.next} />
        <div className="mt-1 flex justify-end text-sm">
          <Link
            className={`${authLinkClass} inline-flex min-h-11 items-center`}
            href="/reset-password"
          >
            Forgot password?
          </Link>
        </div>
        <AuthOAuthOptions />

        <p className="mt-6 text-center text-sm text-(--muted-ink)">
          New to Softmaple?{" "}
          <Link className={authLinkClass} href="/signup">
            Sign up
          </Link>
        </p>
      </AuthPageShell>
    </AuthGuard>
  );
}
