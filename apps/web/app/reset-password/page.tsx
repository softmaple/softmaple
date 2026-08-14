import Link from "next/link";
import { ResetPasswordForm } from "@/modules/auth/reset-password-form";
import { AuthGuard } from "@/modules/auth/auth-guard";
import { AuthShell } from "@/modules/auth/auth-shell";

interface ResetPasswordPageProps {
  searchParams: Promise<{ message?: string; error?: string }>;
}

export default async function ResetPasswordPage({
  searchParams,
}: ResetPasswordPageProps) {
  const params = await searchParams;
  const message = params?.message;
  const error = params?.error;

  return (
    <AuthGuard>
      <AuthShell
        description="Enter your email address and we’ll send you a link to reset your password"
        title="Reset your password"
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

        <ResetPasswordForm />

        <p className="mt-6 text-center text-sm text-muted-foreground">
          Remember your password?{" "}
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
