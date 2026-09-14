"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Eye, EyeOff } from "lucide-react";
import { login } from "@/app/actions/auth";
import { Label } from "@softmaple/ui/components/label";
import { Input } from "@softmaple/ui/components/input";
import { SubmitButton } from "@/modules/auth/submit-button";

export const LoginForm = ({ next }: { readonly next?: string }) => {
  const [state, action] = useActionState(login, null);
  const [showPassword, setShowPassword] = useState(false);
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
    <form action={action} className="space-y-5">
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
      <div className="space-y-2.5">
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
      <div className="space-y-2.5">
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="password">Password</Label>
          <Link
            className="text-xs text-[#767870] underline-offset-4 hover:text-[#8a6d00] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#967200]"
            href="/reset-password"
          >
            Forgot password?
          </Link>
        </div>
        <div className="relative">
          <Input
            aria-describedby={
              passwordError === undefined ? undefined : "password-error"
            }
            aria-invalid={passwordError === undefined ? undefined : true}
            autoComplete="current-password"
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
        {passwordError === undefined ? null : (
          <p className="text-xs text-destructive" id="password-error">
            {passwordError}
          </p>
        )}
      </div>
      <div className="pt-1">
        <SubmitButton text="Log in" loadingText="Logging in..." />
      </div>
    </form>
  );
};
