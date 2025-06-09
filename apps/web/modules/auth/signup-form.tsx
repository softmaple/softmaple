"use client";

import type { FC } from "react";
import { useActionState } from "react";
import { signup } from "@/app/actions/auth";
import { Label } from "@softmaple/ui/components/label";
import { Input } from "@softmaple/ui/components/input";
import { SubmitButton } from "@/modules/auth/submit-button";

export type SignupFormProps = {};

export const SignupForm: FC<SignupFormProps> = () => {
  const [state, action, isPending] = useActionState(signup, undefined);

  return (
    <form action={action} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          placeholder="you@example.com"
          required
        />
        {state?.errors?.email &&
          state.errors.email.errors.map((error) => (
            <p className="text-red-500 text-sm" key={error} aria-live="polite">
              {error}
            </p>
          ))}
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">Password</Label>
        <Input id="password" name="password" type="password" required />
        {state?.errors?.password &&
          state.errors.password.errors.map((error) => (
            <p className="text-red-500 text-sm" key={error} aria-live="polite">
              {error}
            </p>
          ))}
      </div>

      <SubmitButton isPending={isPending} />

      {state?.message && (
        <p className="text-red-500 text-sm" aria-live="polite">
          {state?.message}
        </p>
      )}
    </form>
  );
};
