import { authLinkClass } from "@/modules/auth/auth-styles";
import Link from "next/link";
import { LoginForm } from "@/modules/auth/login-form";
import { AuthGuard } from "@/modules/auth/auth-guard";
import { AuthPageShell } from "@/modules/auth/auth-page-shell";
import { AuthOAuthOptions } from "@/modules/auth/auth-oauth-options";

interface LoginPageProps {
  searchParams: Promise<{ error?: string; message?: string; next?: string }>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const message = params.message;
  const error = params.error;

  return (
    <AuthGuard>
      <AuthPageShell
        mode="login"
        description="Pick up where your ideas left off."
        title="Welcome back"
      >
        {message === undefined ? null : (
          <p
            className="mb-5 border-l-2 border-primary bg-muted px-3 py-2 text-sm text-foreground"
            role="status"
          >
            {message}
          </p>
        )}
        {error === undefined ? null : (
          <p
            className="mb-5 border-l-2 border-destructive bg-destructive/10 px-3 py-2 text-sm text-destructive"
            role="alert"
          >
            {error}
          </p>
        )}

        <LoginForm next={params.next} />
        <div className="mt-3 text-right text-sm">
          <Link className={authLinkClass} href="/reset-password">
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
