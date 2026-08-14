"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { login } from "@/app/actions/auth";
import { Label } from "@softmaple/ui/components/label";
import { Input } from "@softmaple/ui/components/input";
import { SubmitButton } from "@/modules/auth/submit-button";

export const LoginForm = ({ next }: { readonly next?: string }) => {
  const [state, action] = useActionState(login, null);
  const router = useRouter();
  const emailError =
    state !== null && !state.ok ? state.fieldErrors?.email?.[0] : undefined;
  const passwordError =
    state !== null && !state.ok ? state.fieldErrors?.password?.[0] : undefined;

  useEffect(() => {
    if (state?.ok && state.data.redirectTo !== undefined) {
      router.replace(state.data.redirectTo);
    }
  }, [router, state]);

  return (
    <form action={action} className="space-y-4">
      {next === undefined ? null : (
        <input name="next" type="hidden" value={next} />
      )}
      {state !== null && !state.ok ? (
        <p
          className="rounded-sm border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          role="alert"
        >
          {state.message}
        </p>
      ) : null}
      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input
          aria-describedby={
            emailError === undefined ? undefined : "email-error"
          }
          aria-invalid={emailError === undefined ? undefined : true}
          autoComplete="email"
          id="email"
          name="email"
          type="email"
          placeholder="you@example.com"
          required
        />
        {emailError === undefined ? null : (
          <p className="text-xs text-destructive" id="email-error">
            {emailError}
          </p>
        )}
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">Password</Label>
        <Input
          aria-describedby={
            passwordError === undefined ? undefined : "password-error"
          }
          aria-invalid={passwordError === undefined ? undefined : true}
          autoComplete="current-password"
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
      <SubmitButton />
    </form>
  );
};
