"use client";

import { useActionState, useEffect, useState } from "react";
import { PasswordInput } from "./password-input";
import { authInputClass, authSubmitClass } from "./auth-styles";
import { useRouter } from "next/navigation";
import { Label } from "@softmaple/ui/components/label";
import { Input } from "@softmaple/ui/components/input";
import { signup } from "@/app/actions/auth";
import { SubmitButton } from "@/modules/auth/submit-button";

type SignupState = Awaited<ReturnType<typeof signup>> | null;
type SignupField =
  | "firstName"
  | "lastName"
  | "email"
  | "password"
  | "confirmPassword";

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
  const [state, action, pending] = useActionState(signup, null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const router = useRouter();
  const emailError = getFieldError(state, "email");
  const passwordError = getFieldError(state, "password");
  const firstNameError = getFieldError(state, "firstName");
  const lastNameError = getFieldError(state, "lastName");
  const confirmPasswordError = getFieldError(state, "confirmPassword");

  useEffect(() => {
    if (state?.ok && state.data.redirectTo !== undefined) {
      router.replace(state.data.redirectTo);
    }
  }, [router, state]);

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
            className={authInputClass}
            value={firstName}
            onChange={(event) => setFirstName(event.target.value)}
            readOnly={pending}
            autoComplete="given-name"
            id="firstName"
            name="firstName"
            type="text"
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
            className={authInputClass}
            value={lastName}
            onChange={(event) => setLastName(event.target.value)}
            readOnly={pending}
            autoComplete="family-name"
            id="lastName"
            name="lastName"
            type="text"
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
          className={authInputClass}
          placeholder="you@example.com"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          readOnly={pending}
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
        <PasswordInput
          aria-describedby={
            passwordError === undefined
              ? "password-requirements"
              : "password-requirements password-error"
          }
          aria-invalid={passwordError === undefined ? undefined : true}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          readOnly={pending}
          autoComplete="new-password"
          id="password"
          name="password"
          required
        />
        <p
          id="password-requirements"
          className="text-xs leading-5 text-(--muted-ink) min-[56.25rem]:max-xl:leading-4"
        >
          8–128 characters, including a letter and a number.
        </p>
        <FieldError id="password-error" message={passwordError} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="confirmPassword">Confirm password</Label>
        <PasswordInput
          aria-describedby={
            confirmPasswordError === undefined
              ? undefined
              : "confirmPassword-error"
          }
          aria-invalid={confirmPasswordError === undefined ? undefined : true}
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          readOnly={pending}
          visibilityLabel="confirm password"
          autoComplete="new-password"
          id="confirmPassword"
          name="confirmPassword"
          required
        />
        <FieldError id="confirmPassword-error" message={confirmPasswordError} />
      </div>
      <SubmitButton
        text="Create account"
        loadingText="Creating account..."
        className={authSubmitClass}
      />
    </form>
  );
};
