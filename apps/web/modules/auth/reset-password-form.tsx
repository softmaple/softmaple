"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { resetPassword } from "@/app/actions/auth";
import { Label } from "@softmaple/ui/components/label";
import { Input } from "@softmaple/ui/components/input";
import { SubmitButton } from "@/modules/auth/submit-button";
import { AuthNotice } from "./auth-notice";
import { authInputClass, authSubmitClass } from "./auth-styles";

export const ResetPasswordForm = () => {
  const [state, action] = useActionState(resetPassword, null);
  const router = useRouter();
  const emailError =
    state !== null && !state.ok ? state.fieldErrors?.email?.[0] : undefined;

  useEffect(() => {
    if (state?.ok && state.data.redirectTo !== undefined) {
      router.replace(state.data.redirectTo);
    }
  }, [router, state]);

  return (
    <form action={action} className="space-y-5 min-[56.25rem]:max-xl:space-y-4">
      {state === null ? null : (
        <AuthNotice tone={state.ok ? "info" : "error"}>
          {state.ok ? state.data.message : state.message}
        </AuthNotice>
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
