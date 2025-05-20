import type { FC } from "react";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { cn } from "@/lib/utils.ts";

type LexicalContentEditableProps = {
  className?: string;
  placeholderClassName?: string;
  placeholder: string;
};

export const LexicalContentEditable: FC<LexicalContentEditableProps> = (
  props
) => {
  const { className, placeholderClassName, placeholder } = props;

  return (
    <ContentEditable
      className={cn(
        "border-0 block relative outline-0 pt-2 px-11.5 pb-5 min-h-38 lg:px-2",
        className
      )}
      aria-placeholder={placeholder}
      placeholder={
        <div
          className={cn(
            "text-[#999] overflow-hidden absolute overflow-ellipsis top-2 left-11.5 right-7 select-none whitespace-nowrap inline-block pointer-events-none",
            placeholderClassName
          )}
        >
          {placeholder}
        </div>
      }
    />
  );
};
