import Link from "next/link";
import { ResetPasswordForm } from "@/modules/auth/reset-password-form";
import { AuthGuard } from "@/modules/auth/auth-guard";
import { AuthPageShell } from "@/modules/auth/auth-page-shell";
import { authLinkClass } from "@/modules/auth/auth-styles";
import {
  authLinkErrorMessage,
  resetLinkError,
} from "@/modules/auth/auth-link-errors";

interface ResetPasswordPageProps {
  searchParams: Promise<{ message?: string; error?: string }>;
}

export default async function ResetPasswordPage({
  searchParams,
}: ResetPasswordPageProps) {
  const params = await searchParams;
  const message = params?.message;
  const error = authLinkErrorMessage(params?.error);
  const accountError = resetLinkError(params?.error);

  return (
    // Signed-in people reset from account settings; a failed link's notice
    // follows them there.
    <AuthGuard
      redirectTo={
        accountError === undefined
          ? "/settings/account"
          : `/settings/account?error=${accountError}`
      }
    >
      <AuthPageShell
        mode="login"
        description="Enter your email address and we’ll send you a link to reset your password."
        title="Reset your password"
      >
        <ResetPasswordForm initialError={error} initialMessage={message} />

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
