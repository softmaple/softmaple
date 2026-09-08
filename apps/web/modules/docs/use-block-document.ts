"use client";

import { useEffect, useState } from "react";
import type { BlockDocument } from "@softmaple/block-model";
import type { LexicalBinding } from "@softmaple/binding-lexical";

/**
 * The materialised document, refreshed when the replica changes.
 *
 * Read from the replica rather than from Lexical: the replica is the shared
 * truth, it is already the thing remote positions resolve against, and it
 * stays correct while a Lexical update is deferred during IME composition.
 */
export const useBlockDocument = (
  binding: LexicalBinding | null,
): BlockDocument | null => {
  const [document, setDocument] = useState<BlockDocument | null>(null);

  useEffect(() => {
    if (binding === null) {
      setDocument(null);
      return;
    }
    const refresh = (): void => setDocument(binding.replica.getDocument());
    refresh();
    return binding.replica.subscribe(refresh);
  }, [binding]);

  return document;
};
