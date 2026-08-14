import Link from "next/link";
import { UpdatePasswordForm } from "@/modules/auth/update-password-form";
import { AuthShell } from "@/modules/auth/auth-shell";

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
    <AuthShell
      description="Enter your new password below"
      title="Create new password"
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

      <UpdatePasswordForm />

      <p className="mt-6 text-center text-sm text-muted-foreground">
        <Link
          className="text-primary underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          href="/login"
        >
          Back to sign in
        </Link>
      </p>
    </AuthShell>
  );
}
