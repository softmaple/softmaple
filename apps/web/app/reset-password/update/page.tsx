import Link from "next/link";
import { UpdatePasswordForm } from "@/modules/auth/update-password-form";
import { AuthNotice } from "@/modules/auth/auth-notice";
import { AuthPageShell } from "@/modules/auth/auth-page-shell";
import { authLinkClass } from "@/modules/auth/auth-styles";

interface UpdatePasswordPageProps {
  searchParams: Promise<{ message?: string; error?: string }>;
}

export default async function UpdatePasswordPage({
  searchParams,
}: UpdatePasswordPageProps) {
  const params = await searchParams;
  const message = params?.message;
  const error = params?.error;

  return (
    <AuthPageShell
      mode="login"
      description="Choose a new password for your account."
      title="Create new password"
    >
      {message === undefined ? null : (
        <AuthNotice className="mb-5">{message}</AuthNotice>
      )}
      {error === undefined ? null : (
        <AuthNotice className="mb-5" tone="error">
          {error}
        </AuthNotice>
      )}

      <UpdatePasswordForm />

      <p className="mt-6 text-center text-sm text-(--muted-ink)">
        <Link className={authLinkClass} href="/login">
          Back to log in
        </Link>
      </p>
    </AuthPageShell>
  );
}
