"use client";

import { useActionState } from "react";
import { resetPassword } from "@/app/actions/auth";
import { Label } from "@softmaple/ui/components/label";
import { Input } from "@softmaple/ui/components/input";
import { SubmitButton } from "@/modules/auth/submit-button";
import { authInputClass, authSubmitClass } from "./auth-styles";

export const ResetPasswordForm = () => {
  const [state, action] = useActionState(resetPassword, null);
  const emailError =
    state !== null && !state.ok ? state.fieldErrors?.email?.[0] : undefined;

  return (
    <form action={action} className="space-y-5 min-[56.25rem]:max-xl:space-y-4">
      {state === null ? null : (
        <p
          className={
            state.ok
              ? "border-l-2 border-primary bg-muted px-3 py-2 text-sm text-foreground"
              : "border-l-2 border-destructive bg-destructive/10 px-3 py-2 text-sm text-destructive"
          }
          role={state.ok ? "status" : "alert"}
        >
          {state.ok ? state.data.message : state.message}
        </p>
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
      <SubmitButton text="Send reset link" className={authSubmitClass} />
    </form>
  );
};
