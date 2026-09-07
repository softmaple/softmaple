"use client";

import { useEffect, useRef } from "react";
import { Search } from "lucide-react";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@softmaple/ui/components/input-group";
import { Kbd } from "@softmaple/ui/components/kbd";

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
      if (
        event.key !== "/" ||
        event.defaultPrevented ||
        event.isComposing ||
        event.repeat ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey
      )
        return;
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest(
          "input, textarea, select, [contenteditable]:not([contenteditable='false']), [role='textbox']",
        )
      )
        return;
      const input = inputRef.current;
      // Both workspace sidebars are mounted; only the visible, non-modal-hidden
      // search field can own the shortcut.
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
        aria-keyshortcuts="/"
        placeholder={label}
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && value) {
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
