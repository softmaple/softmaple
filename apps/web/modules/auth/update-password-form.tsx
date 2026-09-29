"use client";

import { useActionState, useState } from "react";
import { updatePassword } from "@/app/actions/auth";
import { Label } from "@softmaple/ui/components/label";
import { SubmitButton } from "@/modules/auth/submit-button";
import { AuthNotice } from "./auth-notice";
import { authSubmitClass } from "./auth-styles";
import { PasswordInput } from "./password-input";

export const UpdatePasswordForm = () => {
  const [state, action, pending] = useActionState(updatePassword, null);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const confirmPasswordError =
    state !== null && !state.ok
      ? state.fieldErrors?.confirmPassword?.[0]
      : undefined;
  const passwordError =
    state !== null && !state.ok ? state.fieldErrors?.password?.[0] : undefined;

  return (
    <form
      action={action}
      aria-busy={pending}
      onSubmit={(event) => {
        if (pending) event.preventDefault();
      }}
      className="space-y-5 min-[56.25rem]:max-xl:space-y-4"
    >
      {state !== null && !state.ok ? (
        <AuthNotice tone="error">{state.message}</AuthNotice>
      ) : null}
      <div className="space-y-2">
        <Label htmlFor="password">New password</Label>
        <PasswordInput
          aria-describedby={
            passwordError === undefined
              ? "password-requirements"
              : "password-requirements password-error"
          }
          aria-invalid={passwordError === undefined ? undefined : true}
          autoComplete="new-password"
          enterKeyHint="next"
          id="password"
          name="password"
          minLength={8}
          maxLength={128}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          readOnly={pending}
          required
        />
        <p
          id="password-requirements"
          className="text-xs leading-5 text-(--muted-ink)"
        >
          8–128 characters, including a letter and a number.
        </p>
        {passwordError === undefined ? null : (
          <p className="text-xs text-destructive" id="password-error">
            {passwordError}
          </p>
        )}
      </div>
      <div className="space-y-2">
        <Label htmlFor="confirmPassword">Confirm new password</Label>
        <PasswordInput
          aria-describedby={
            confirmPasswordError === undefined
              ? undefined
              : "confirmPassword-error"
          }
          aria-invalid={confirmPasswordError === undefined ? undefined : true}
          autoComplete="new-password"
          enterKeyHint="go"
          visibilityLabel="confirm password"
          id="confirmPassword"
          name="confirmPassword"
          minLength={8}
          maxLength={128}
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          readOnly={pending}
          required
        />
        {confirmPasswordError === undefined ? null : (
          <p className="text-xs text-destructive" id="confirmPassword-error">
            {confirmPasswordError}
          </p>
        )}
      </div>
      <SubmitButton
        text="Update password"
        loadingText="Updating password…"
        className={authSubmitClass}
      />
    </form>
  );
};
