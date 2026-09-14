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
        artTitle={
          <>
            Good to have <span className="auth-brush">you back.</span>
          </>
        }
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

        <AuthOAuthOptions mode="sign-in" />
        <LoginForm next={params.next} />

        <p className="mt-7 text-center text-sm text-[#676963]">
          New to Softmaple?{" "}
          <Link
            className="text-[#8a6d00] underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#967200]"
            href="/signup"
          >
            Sign up
          </Link>
        </p>
      </AuthShell>
    </AuthGuard>
  );
}
