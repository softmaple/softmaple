import type { FC } from "react";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { cn } from "@softmaple/editor/lib/utils.ts";

type LexicalContentEditableProps = {
  className?: string;
  placeholderClassName?: string;
  placeholder: string;
};

export const LexicalContentEditable: FC<LexicalContentEditableProps> = (
  props,
) => {
  const { className, placeholderClassName, placeholder } = props;

  return (
    <ContentEditable
      className={cn(
        "border-0 block relative outline-0 pt-2 px-11.5 pb-5 min-h-38 lg:px-2",
        className,
      )}
      aria-placeholder={placeholder}
      aria-label="Rich text editor"
      placeholder={
        <div
          className={cn(
            "text-muted-foreground overflow-hidden absolute overflow-ellipsis top-2 left-11.5 right-7 select-none whitespace-nowrap inline-block pointer-events-none lg:left-2",
            placeholderClassName,
          )}
        >
          {placeholder}
        </div>
      }
    />
  );
};
