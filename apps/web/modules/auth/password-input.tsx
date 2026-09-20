"use client";

import { useState, type ComponentProps } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Input } from "@softmaple/ui/components/input";
import { authInputClass } from "./auth-styles";

export function PasswordInput({
  visibilityLabel = "password",
  ...props
}: Omit<ComponentProps<typeof Input>, "type"> & {
  readonly visibilityLabel?: string;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <Input
        {...props}
        type={visible ? "text" : "password"}
        className={`${authInputClass} pr-12`}
      />
      <button
        type="button"
        aria-label={`${visible ? "Hide" : "Show"} ${visibilityLabel}`}
        aria-controls={props.id}
        aria-pressed={visible}
        onClick={() => setVisible((current) => !current)}
        className="absolute inset-y-0 right-0 flex w-12 items-center justify-center rounded-md text-(--ink) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#967200]"
      >
        {visible ? (
          <EyeOff aria-hidden="true" className="size-[18px]" />
        ) : (
          <Eye aria-hidden="true" className="size-[18px]" />
        )}
      </button>
    </div>
  );
}
