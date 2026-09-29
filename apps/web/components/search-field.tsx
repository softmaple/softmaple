"use client";

import { useEffect, useRef } from "react";
import { Search, X } from "lucide-react";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
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
    <InputGroup className="h-11 md:h-9">
      <InputGroupInput
        ref={inputRef}
        aria-label={label}
        aria-keyshortcuts="/"
        placeholder={label}
        autoComplete="off"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="search"
        className="[&::-webkit-search-cancel-button]:appearance-none"
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
      {value ? (
        <InputGroupAddon align="inline-end" className="py-0 pr-1">
          <InputGroupButton
            aria-label="Clear search"
            className="size-11 md:size-8"
            size="icon-sm"
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => {
              onChange("");
              inputRef.current?.focus();
            }}
          >
            <X aria-hidden="true" />
          </InputGroupButton>
        </InputGroupAddon>
      ) : null}
      <InputGroupAddon align="inline-end" className="hidden md:flex">
        <Kbd aria-hidden="true">/</Kbd>
      </InputGroupAddon>
    </InputGroup>
  );
}
