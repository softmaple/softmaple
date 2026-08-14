"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Label } from "@softmaple/ui/components/label";
import { Input } from "@softmaple/ui/components/input";
import { signup } from "@/app/actions/auth";
import { SubmitButton } from "@/modules/auth/submit-button";

type SignupState = Awaited<ReturnType<typeof signup>> | null;
type SignupField =
  | "confirmPassword"
  | "email"
  | "firstName"
  | "lastName"
  | "password";

const getFieldError = (
  state: SignupState,
  field: SignupField,
): string | undefined =>
  state !== null && !state.ok ? state.fieldErrors?.[field]?.[0] : undefined;

const FieldError = ({ id, message }: { id: string; message?: string }) =>
  message === undefined ? null : (
    <p className="text-xs text-destructive" id={id}>
      {message}
    </p>
  );

export const SignupForm = () => {
  const [state, action] = useActionState(signup, null);
  const router = useRouter();
  const confirmPasswordError = getFieldError(state, "confirmPassword");
  const emailError = getFieldError(state, "email");
  const firstNameError = getFieldError(state, "firstName");
  const lastNameError = getFieldError(state, "lastName");
  const passwordError = getFieldError(state, "password");

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
            aria-describedby={
              firstNameError === undefined ? undefined : "firstName-error"
            }
            aria-invalid={firstNameError === undefined ? undefined : true}
            autoComplete="given-name"
            id="firstName"
            name="firstName"
            required
          />
          <FieldError id="firstName-error" message={firstNameError} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="lastName">Last name</Label>
          <Input
            aria-describedby={
              lastNameError === undefined ? undefined : "lastName-error"
            }
            aria-invalid={lastNameError === undefined ? undefined : true}
            autoComplete="family-name"
            id="lastName"
            name="lastName"
            required
          />
          <FieldError id="lastName-error" message={lastNameError} />
        </div>
      </div>
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
          required
        />
        <FieldError id="email-error" message={emailError} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">Password</Label>
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
        <FieldError id="password-error" message={passwordError} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="confirmPassword">Confirm password</Label>
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
        <FieldError id="confirmPassword-error" message={confirmPasswordError} />
      </div>
      <SubmitButton text="Create account" loadingText="Creating account..." />
    </form>
  );
};
