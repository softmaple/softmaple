"use client";

import { Button } from "@softmaple/ui/components/button";
import { useFormStatus } from "react-dom";

export const SubmitButton = () => {
  const { pending: isLoading } = useFormStatus();

  return (
    <Button type="submit" className="w-full" disabled={isLoading}>
      {isLoading ? "Signing in..." : "Sign in"}
    </Button>
  );
};
