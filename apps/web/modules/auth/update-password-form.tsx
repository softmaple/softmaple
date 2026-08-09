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
  useEffect(() => {
    if (state?.ok && state.data.redirectTo !== undefined) {
      router.replace(state.data.redirectTo);
    }
  }, [router, state]);

  return (
    <form action={action} className="space-y-4">
      {state !== null && !state.ok ? (
        <p className="text-sm text-destructive" role="alert">
          {state.message}
        </p>
      ) : null}
      <div className="space-y-2">
        <Label htmlFor="password">New password</Label>
        <Input
          autoComplete="new-password"
          id="password"
          name="password"
          type="password"
          required
        />
        <p className="text-xs text-destructive">
          {state !== null && !state.ok
            ? state.fieldErrors?.password?.[0]
            : null}
        </p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="confirmPassword">Confirm new password</Label>
        <Input
          autoComplete="new-password"
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          required
        />
        <p className="text-xs text-destructive">
          {state !== null && !state.ok
            ? state.fieldErrors?.confirmPassword?.[0]
            : null}
        </p>
      </div>
      <SubmitButton text="Update password" />
    </form>
  );
};
