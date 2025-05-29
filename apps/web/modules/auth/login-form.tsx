"use client";

import type { FC } from "react";
import { login } from "@/app/actions";
import { Label } from "@softmaple/ui/components/label";
import { Input } from "@softmaple/ui/components/input";
import { Button } from "@softmaple/ui/components/button";
import { useFormStatus } from "react-dom";

const SubmitButton = () => {
  const { pending: isLoading } = useFormStatus();

  return (
    <Button type="submit" className="w-full" disabled={isLoading}>
      {isLoading ? "Signing in..." : "Sign in"}
    </Button>
  );
};

export type LoginFormProps = {};

export const LoginForm: FC<LoginFormProps> = (props) => {
  return (
    <form action={login} className="space-y-4">
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
      <div className="space-y-2">
        <Label htmlFor="password">Password</Label>
        <Input id="password" name="password" type="password" required />
      </div>

      <SubmitButton />
    </form>
  );
};
