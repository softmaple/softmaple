"use client";

import { Button } from "@softmaple/ui/components/button";
import { useFormStatus } from "react-dom";

interface SubmitButtonProps {
  className?: string;
  text?: string;
  loadingText?: string;
  disabled?: boolean;
}

export const SubmitButton = ({
  className = "",
  text = "Sign in",
  loadingText,
  disabled = false,
}: SubmitButtonProps = {}) => {
  const { pending: isLoading } = useFormStatus();
  const displayLoadingText = loadingText || `${text.replace(/\.$/, "")}...`;

  return (
    <Button
      type="submit"
      className={`w-full ${className}`}
      aria-busy={isLoading}
      aria-live="polite"
      disabled={isLoading || disabled}
    >
      {isLoading ? displayLoadingText : text}
    </Button>
  );
};
