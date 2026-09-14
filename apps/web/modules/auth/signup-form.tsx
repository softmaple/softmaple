"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff } from "lucide-react";
import { Label } from "@softmaple/ui/components/label";
import { Input } from "@softmaple/ui/components/input";
import { signup } from "@/app/actions/auth";
import { SubmitButton } from "@/modules/auth/submit-button";

const FieldError = ({ id, message }: { id: string; message?: string }) =>
  message === undefined ? null : (
    <p className="text-xs text-destructive" id={id}>
      {message}
    </p>
  );

export const SignupForm = () => {
  const [state, action] = useActionState(signup, null);
  const [showPassword, setShowPassword] = useState(false);
  const router = useRouter();
  const emailError =
    state !== null && !state.ok ? state.fieldErrors?.email?.[0] : undefined;
  const passwordError =
    state !== null && !state.ok ? state.fieldErrors?.password?.[0] : undefined;

  useEffect(() => {
    if (state?.ok && state.data.redirectTo !== undefined)
      router.replace(state.data.redirectTo);
  }, [router, state]);

  return (
    <form action={action} className="space-y-5">
      {state !== null && !state.ok ? (
        <p
          className="border-l-2 border-destructive bg-destructive/10 px-3 py-2 text-sm text-destructive"
          role="alert"
        >
          {state.message}
        </p>
      ) : null}
      <div className="space-y-2.5">
        <Label htmlFor="email">Email</Label>
        <Input
          aria-describedby={
            emailError === undefined ? undefined : "email-error"
          }
          aria-invalid={emailError === undefined ? undefined : true}
          autoComplete="email"
          className="h-11 bg-[#fffefa]"
          id="email"
          name="email"
          type="email"
          placeholder="you@example.com"
          required
        />
        <FieldError id="email-error" message={emailError} />
      </div>
      <div className="space-y-2.5">
        <Label htmlFor="password">Password</Label>
        <div className="relative">
          <Input
            aria-describedby={
              passwordError === undefined
                ? "password-requirements"
                : "password-requirements password-error"
            }
            aria-invalid={passwordError === undefined ? undefined : true}
            autoComplete="new-password"
            className="h-11 bg-[#fffefa] pr-11"
            id="password"
            name="password"
            type={showPassword ? "text" : "password"}
            required
          />
          <button
            aria-label={showPassword ? "Hide password" : "Show password"}
            className="absolute right-2 top-1/2 inline-flex size-8 -translate-y-1/2 items-center justify-center rounded-sm text-[#777973] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#967200]"
            onClick={() => setShowPassword((visible) => !visible)}
            type="button"
          >
            {showPassword ? (
              <EyeOff className="size-4" />
            ) : (
              <Eye className="size-4" />
            )}
          </button>
        </div>
        <p
          className="text-xs leading-5 text-[#777973]"
          id="password-requirements"
        >
          At least 8 characters, including a letter and a number.
        </p>
        <FieldError id="password-error" message={passwordError} />
      </div>
      <SubmitButton text="Create account" loadingText="Creating account..." />
    </form>
  );
};
