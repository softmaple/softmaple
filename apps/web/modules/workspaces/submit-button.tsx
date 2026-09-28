"use client";

import type { FC, Dispatch, SetStateAction } from "react";
import { Button } from "@softmaple/ui/components/button";
import { useFormStatus } from "react-dom";

export type SubmitButtonProps = {
  onOpenChange: Dispatch<SetStateAction<boolean>>;
};

export const SubmitButton: FC<SubmitButtonProps> = (props) => {
  const { onOpenChange } = props;

  const { pending: isLoading } = useFormStatus();

  return (
    <>
      <Button
        type="button"
        variant="outline"
        className="h-11 md:h-9"
        onClick={() => onOpenChange(false)}
        disabled={isLoading}
      >
        Cancel
      </Button>
      <Button
        type="submit"
        className="h-11 md:h-9"
        aria-busy={isLoading}
        disabled={isLoading}
      >
        {isLoading ? "Creating…" : "Create workspace"}
      </Button>
    </>
  );
};
