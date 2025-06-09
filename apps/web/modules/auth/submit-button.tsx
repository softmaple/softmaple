"use client";

import type { FC } from "react";
import { Button } from "@softmaple/ui/components/button";
import { useFormStatus } from "react-dom";

export type SubmitButtonProps = {
  isPending?: boolean;
};

export const SubmitButton: FC<SubmitButtonProps> = ({ isPending }) => {
  const { pending } = useFormStatus();
  const isLoading = isPending || pending;

  return (
    <Button type="submit" className="w-full" disabled={isLoading}>
      {isLoading ? "Signing in..." : "Sign in"}
    </Button>
  );
};
