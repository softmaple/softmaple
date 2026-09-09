import Link from "next/link";
import { LoginForm } from "@/modules/auth/login-form";
import { AuthGuard } from "@/modules/auth/auth-guard";
import { AuthShell } from "@/modules/auth/auth-shell";
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
      <AuthShell
        description="Sign in to your Softmaple account"
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

        <div className="mt-3 text-right">
          <Link
            className="text-sm text-muted-foreground transition-colors hover:text-emphasis focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            href="/reset-password"
          >
            Forgot password?
          </Link>
        </div>

        <AuthOAuthOptions mode="sign-in" />

        <p className="mt-6 text-center text-sm text-muted-foreground">
          Don&apos;t have an account?{" "}
          <Link
            className="text-emphasis underline underline-offset-4 focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            href="/signup"
          >
            Sign up
          </Link>
        </p>
      </AuthShell>
    </AuthGuard>
  );
}
