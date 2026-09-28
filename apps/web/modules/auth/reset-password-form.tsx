"use client";

import { useActionState, useState } from "react";
import { resetPassword, type AuthActionData } from "@/app/actions/auth";
import type { ActionResult } from "@/lib/actions/result";
import { Label } from "@softmaple/ui/components/label";
import { Input } from "@softmaple/ui/components/input";
import { SubmitButton } from "@/modules/auth/submit-button";
import { AuthNotice } from "./auth-notice";
import { authInputClass, authLinkClass, authSubmitClass } from "./auth-styles";

interface ResetPasswordFormProps {
  /** Notices the page arrived with, such as a failed reset link. */
  readonly initialMessage?: string;
  readonly initialError?: string;
}

/**
 * Asks for an email, then stays put to confirm the link went out: the next
 * step is the inbox, and resending or fixing a typo is one click away.
 */
export const ResetPasswordForm = ({
  initialMessage,
  initialError,
}: ResetPasswordFormProps) => {
  // A new key remounts the flow, clearing its action state.
  const [attempt, setAttempt] = useState(0);
  const [defaultEmail, setDefaultEmail] = useState("");

  return (
    <ResetPasswordFlow
      defaultEmail={defaultEmail}
      initialError={attempt === 0 ? initialError : undefined}
      initialMessage={attempt === 0 ? initialMessage : undefined}
      key={attempt}
      onChangeEmail={(email) => {
        setDefaultEmail(email);
        setAttempt((count) => count + 1);
      }}
    />
  );
};

interface ResetPasswordFlowProps extends ResetPasswordFormProps {
  readonly defaultEmail: string;
  readonly onChangeEmail: (email: string) => void;
}

interface Sent {
  readonly email: string;
  readonly count: number;
}

const ResetPasswordFlow = ({
  defaultEmail,
  initialMessage,
  initialError,
  onChangeEmail,
}: ResetPasswordFlowProps) => {
  // Kept apart from the action state so a failed resend keeps the confirmation.
  const [sent, setSent] = useState<Sent | null>(null);
  const [state, action] = useActionState(
    async (
      previousState: ActionResult<AuthActionData> | null,
      formData: FormData,
    ) => {
      const result = await resetPassword(previousState, formData);
      if (result.ok) {
        setSent((current) => ({
          email: result.data.email ?? "",
          count: (current?.count ?? 0) + 1,
        }));
      }
      return result;
    },
    null,
  );
  const failure = state !== null && !state.ok ? state : undefined;

  if (sent !== null) {
    return (
      <div className="space-y-5 min-[56.25rem]:max-xl:space-y-4">
        <AuthNotice>
          If an account uses{" "}
          <strong className="font-semibold break-all">{sent.email}</strong>,{" "}
          {sent.count > 1 ? "another" : "a"} password reset link is on its way.
        </AuthNotice>
        {failure === undefined ? null : (
          <AuthNotice tone="error">{failure.message}</AuthNotice>
        )}
        <p className="text-sm leading-6 text-(--muted-ink)">
          Didn’t get it? Check your spam folder, or send it again.
        </p>
        <form action={action}>
          <input name="email" type="hidden" value={sent.email} />
          <SubmitButton
            text="Resend reset link"
            loadingText="Sending link…"
            className={authSubmitClass}
          />
        </form>
        <p className="text-center text-sm text-(--muted-ink)">
          Wrong address?{" "}
          <button
            className={`${authLinkClass} cursor-pointer`}
            onClick={() => onChangeEmail(sent.email)}
            type="button"
          >
            Use a different email
          </button>
        </p>
      </div>
    );
  }

  const emailError = failure?.fieldErrors?.email?.[0];
  const notice =
    failure === undefined
      ? initialError === undefined
        ? initialMessage === undefined
          ? null
          : { tone: "info" as const, text: initialMessage }
        : { tone: "error" as const, text: initialError }
      : { tone: "error" as const, text: failure.message };

  return (
    <form action={action} className="space-y-5 min-[56.25rem]:max-xl:space-y-4">
      {notice === null ? null : (
        <AuthNotice tone={notice.tone}>{notice.text}</AuthNotice>
      )}
      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input
          aria-describedby={
            emailError === undefined ? undefined : "email-error"
          }
          aria-invalid={emailError === undefined ? undefined : true}
          className={authInputClass}
          placeholder="you@example.com"
          autoComplete="email"
          defaultValue={defaultEmail}
          id="email"
          name="email"
          type="email"
          required
        />
        {emailError === undefined ? null : (
          <p className="text-xs text-destructive" id="email-error">
            {emailError}
          </p>
        )}
      </div>
      <SubmitButton
        text="Send reset link"
        loadingText="Sending link…"
        className={authSubmitClass}
      />
    </form>
  );
};
