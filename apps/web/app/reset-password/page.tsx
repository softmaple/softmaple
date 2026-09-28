import Link from "next/link";
import { ResetPasswordForm } from "@/modules/auth/reset-password-form";
import { AuthGuard } from "@/modules/auth/auth-guard";
import { AuthNotice } from "@/modules/auth/auth-notice";
import { AuthPageShell } from "@/modules/auth/auth-page-shell";
import { authLinkClass } from "@/modules/auth/auth-styles";

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
      <AuthPageShell
        mode="login"
        description="Enter your email address and we’ll send you a link to reset your password."
        title="Reset your password"
      >
        {message === undefined ? null : (
          <AuthNotice className="mb-5">{message}</AuthNotice>
        )}
        {error === undefined ? null : (
          <AuthNotice className="mb-5" tone="error">
            {error}
          </AuthNotice>
        )}

        <ResetPasswordForm />

        <p className="mt-6 text-center text-sm text-(--muted-ink)">
          Remember your password?{" "}
          <Link className={authLinkClass} href="/login">
            Log in
          </Link>
        </p>
      </AuthPageShell>
    </AuthGuard>
  );
}
