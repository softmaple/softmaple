"use client";

import { useActionState } from "react";
import { resetPassword } from "@/app/actions/auth";
import { Label } from "@softmaple/ui/components/label";
import { Input } from "@softmaple/ui/components/input";
import { SubmitButton } from "@/modules/auth/submit-button";

export const ResetPasswordForm = () => {
  const [state, action] = useActionState(resetPassword, null);
  return (
    <form action={action} className="space-y-4">
      {state === null ? null : (
        <p
          className={
            state.ok ? "text-sm text-teal-600" : "text-sm text-destructive"
          }
          role="status"
        >
          {state.ok ? state.data.message : state.message}
        </p>
      )}
      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input
          autoComplete="email"
          id="email"
          name="email"
          type="email"
          required
        />
        <p className="text-xs text-destructive">
          {state !== null && !state.ok ? state.fieldErrors?.email?.[0] : null}
        </p>
      </div>
      <SubmitButton text="Send reset link" />
    </form>
  );
};
