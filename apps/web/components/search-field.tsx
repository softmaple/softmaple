"use client";

import { useEffect, useRef } from "react";
import { Search } from "lucide-react";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@softmaple/ui/components/input-group";
import { Kbd } from "@softmaple/ui/components/kbd";
import { opensSearch } from "@/components/search-shortcut";

export function SearchField({
  label,
  value,
  onChange,
}: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if (!opensSearch(event)) return;
      const input = inputRef.current;
      // Both workspace navigators can be mounted at once; only the visible,
      // non-modal-hidden search field may own the shortcut.
      if (
        !input ||
        input.getClientRects().length === 0 ||
        input.closest('[inert], [aria-hidden="true"]')
      )
        return;
      event.preventDefault();
      input.focus();
    };
    document.addEventListener("keydown", focusSearch);
    return () => document.removeEventListener("keydown", focusSearch);
  }, []);

  return (
    <InputGroup>
      <InputGroupInput
        ref={inputRef}
        aria-label={label}
        aria-keyshortcuts="/ Meta+K Control+K"
        placeholder={label}
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          // Escape during IME composition commits/cancels the candidate
          // window; it must not clear the query.
          if (
            event.key === "Escape" &&
            !event.nativeEvent.isComposing &&
            value
          ) {
            event.preventDefault();
            event.stopPropagation();
            onChange("");
          }
        }}
      />
      <InputGroupAddon>
        <Search />
      </InputGroupAddon>
      <InputGroupAddon align="inline-end">
        <Kbd aria-hidden="true">/</Kbd>
      </InputGroupAddon>
    </InputGroup>
  );
}
