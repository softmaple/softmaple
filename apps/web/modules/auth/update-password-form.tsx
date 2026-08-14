"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { updatePassword } from "@/app/actions/auth";
import { Label } from "@softmaple/ui/components/label";
import { Input } from "@softmaple/ui/components/input";
import { SubmitButton } from "@/modules/auth/submit-button";

export const UpdatePasswordForm = () => {
  const [state, action] = useActionState(updatePassword, null);
  const router = useRouter();
  const confirmPasswordError =
    state !== null && !state.ok
      ? state.fieldErrors?.confirmPassword?.[0]
      : undefined;
  const passwordError =
    state !== null && !state.ok ? state.fieldErrors?.password?.[0] : undefined;

  useEffect(() => {
    if (state?.ok && state.data.redirectTo !== undefined) {
      router.replace(state.data.redirectTo);
    }
  }, [router, state]);

  return (
    <form action={action} className="space-y-4">
      {state !== null && !state.ok ? (
        <p
          className="border-l-2 border-destructive bg-destructive/10 px-3 py-2 text-sm text-destructive"
          role="alert"
        >
          {state.message}
        </p>
      ) : null}
      <div className="space-y-2">
        <Label htmlFor="password">New password</Label>
        <Input
          aria-describedby={
            passwordError === undefined ? undefined : "password-error"
          }
          aria-invalid={passwordError === undefined ? undefined : true}
          autoComplete="new-password"
          id="password"
          name="password"
          type="password"
          required
        />
        {passwordError === undefined ? null : (
          <p className="text-xs text-destructive" id="password-error">
            {passwordError}
          </p>
        )}
      </div>
      <div className="space-y-2">
        <Label htmlFor="confirmPassword">Confirm new password</Label>
        <Input
          aria-describedby={
            confirmPasswordError === undefined
              ? undefined
              : "confirmPassword-error"
          }
          aria-invalid={confirmPasswordError === undefined ? undefined : true}
          autoComplete="new-password"
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          required
        />
        {confirmPasswordError === undefined ? null : (
          <p className="text-xs text-destructive" id="confirmPassword-error">
            {confirmPasswordError}
          </p>
        )}
      </div>
      <SubmitButton text="Update password" />
    </form>
  );
};
