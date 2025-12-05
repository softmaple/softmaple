"use client";

import { Button } from "@softmaple/ui/components/button";
import { useFormStatus } from "react-dom";

interface SubmitButtonProps {
  text?: string;
  loadingText?: string;
  disabled?: boolean;
}

export const SubmitButton = ({ 
  text = "Sign in", 
  loadingText,
  disabled = false 
}: SubmitButtonProps = {}) => {
  const { pending: isLoading } = useFormStatus();
  const displayLoadingText = loadingText || `${text.replace(/\.$/, '')}...`;

  return (
    <Button type="submit" className="w-full" disabled={isLoading || disabled}>
      {isLoading ? displayLoadingText : text}
    </Button>
  );
};
