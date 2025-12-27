"use client";

import { useState, type FC } from "react";
import { updatePassword } from "@/app/actions/auth";
import { Label } from "@softmaple/ui/components/label";
import { Input } from "@softmaple/ui/components/input";
import { SubmitButton } from "@/modules/auth/submit-button";

export type UpdatePasswordFormProps = {};

export const UpdatePasswordForm: FC<UpdatePasswordFormProps> = (props) => {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");

  const validatePasswords = (
    pwd: string = password,
    confirmPwd: string = confirmPassword,
  ) => {
    if (pwd && confirmPwd && pwd !== confirmPwd) {
      setError("Passwords do not match");
      return false;
    }
    if (pwd && pwd.length < 6) {
      setError("Password must be at least 6 characters");
      return false;
    }
    setError("");
    return true;
  };

  return (
    <form action={updatePassword} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="password">New Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            validatePasswords(e.target.value, confirmPassword);
          }}
          placeholder="Enter new password"
          required
          minLength={6}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="confirmPassword">Confirm New Password</Label>
        <Input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          value={confirmPassword}
          onChange={(e) => {
            setConfirmPassword(e.target.value);
            validatePasswords(password, e.target.value);
          }}
          placeholder="Confirm new password"
          required
          minLength={6}
        />
      </div>

      {error && <div className="text-sm text-red-600">{error}</div>}

      <SubmitButton
        text="Update password"
        disabled={!!error || !password || !confirmPassword}
      />
    </form>
  );
};
