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
        onClick={() => onOpenChange(false)}
        disabled={isLoading}
      >
        Cancel
      </Button>
      <Button type="submit" disabled={isLoading}>
        {isLoading ? "Creating..." : "Create Workspace"}
      </Button>
    </>
  );
};
