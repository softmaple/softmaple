"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Label } from "@softmaple/ui/components/label";
import { Input } from "@softmaple/ui/components/input";
import { signup } from "@/app/actions/auth";
import { SubmitButton } from "@/modules/auth/submit-button";

const FieldError = ({
  field,
  state,
}: {
  readonly field: string;
  readonly state: Awaited<ReturnType<typeof signup>> | null;
}) => (
  <p className="text-xs text-destructive" id={`${field}-error`}>
    {state !== null && !state.ok ? state.fieldErrors?.[field]?.[0] : null}
  </p>
);

export const SignupForm = () => {
  const [state, action] = useActionState(signup, null);
  const router = useRouter();

  useEffect(() => {
    if (state?.ok && state.data.redirectTo !== undefined) {
      router.replace(state.data.redirectTo);
    }
  }, [router, state]);

  return (
    <form action={action} className="space-y-4">
      {state !== null && !state.ok ? (
        <p
          className="rounded-sm border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          role="alert"
        >
          {state.message}
        </p>
      ) : null}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="firstName">First name</Label>
          <Input
            autoComplete="given-name"
            id="firstName"
            name="firstName"
            required
          />
          <FieldError field="firstName" state={state} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="lastName">Last name</Label>
          <Input
            autoComplete="family-name"
            id="lastName"
            name="lastName"
            required
          />
          <FieldError field="lastName" state={state} />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input
          autoComplete="email"
          id="email"
          name="email"
          type="email"
          required
        />
        <FieldError field="email" state={state} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">Password</Label>
        <Input
          autoComplete="new-password"
          id="password"
          name="password"
          type="password"
          required
        />
        <FieldError field="password" state={state} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="confirmPassword">Confirm password</Label>
        <Input
          autoComplete="new-password"
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          required
        />
        <FieldError field="confirmPassword" state={state} />
      </div>
      <SubmitButton text="Create account" loadingText="Creating account..." />
    </form>
  );
};
