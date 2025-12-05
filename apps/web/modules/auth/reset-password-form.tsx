import type { FC } from "react";
import { resetPassword } from "@/app/actions/auth";
import { Label } from "@softmaple/ui/components/label";
import { Input } from "@softmaple/ui/components/input";
import { SubmitButton } from "@/modules/auth/submit-button";

export type ResetPasswordFormProps = {};

export const ResetPasswordForm: FC<ResetPasswordFormProps> = (props) => {
  return (
    <form action={resetPassword} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          placeholder="you@example.com"
          required
        />
      </div>

      <SubmitButton text="Send reset link" />
    </form>
  );
};
