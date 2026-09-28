"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { CircleAlert, CircleCheck, KeyRound, LoaderCircle } from "lucide-react";
import { Button } from "@softmaple/ui/components/button";
import { sendPasswordResetLink } from "@/app/actions/auth";
import type { PaperFeedbackMessage } from "@/modules/workspaces/workspace-paper";

const SEND_FAILED = "Could not send the reset link. Try again.";

/**
 * Emails a reset link to the signed-in account without leaving settings.
 * The result appears under the button that caused it, in its own polite
 * region: the page's profile feedback already owns `role="status"`.
 * `initialError` explains a reset link that failed and sent the person here.
 */
export function PasswordReset({
  initialError,
}: {
  readonly initialError?: string;
}) {
  const [result, setResult] = useState<PaperFeedbackMessage | null>(
    initialError === undefined ? null : { error: true, text: initialError },
  );
  const [isSending, startSending] = useTransition();
  const sent = result !== null && !result.error;
  const alertRef = useRef<HTMLParagraphElement>(null);

  // The row sits at the end of the page; bring a failed link's notice into
  // view with the button that fixes it.
  useEffect(() => {
    if (initialError !== undefined) {
      alertRef.current?.scrollIntoView({ block: "center" });
    }
  }, [initialError]);

  const send = (): void => {
    setResult(null);
    startSending(async () => {
      try {
        const response = await sendPasswordResetLink();
        setResult(
          response.ok
            ? {
                error: false,
                text: response.data.message ?? "Reset link sent.",
              }
            : { error: true, text: response.message },
        );
      } catch {
        setResult({ error: true, text: SEND_FAILED });
      }
    });
  };

  return (
    <div className="min-w-0">
      <Button
        className="h-10 md:h-9"
        disabled={isSending}
        onClick={send}
        type="button"
        variant="outline"
      >
        {isSending ? (
          <LoaderCircle
            aria-hidden="true"
            className="animate-spin"
            data-icon="inline-start"
          />
        ) : (
          <KeyRound aria-hidden="true" data-icon="inline-start" />
        )}
        {isSending
          ? "Sending…"
          : sent
            ? "Resend reset link"
            : "Send reset link"}
      </Button>
      <p aria-atomic="true" aria-live="polite" className="text-xs leading-5">
        {sent ? (
          <span className="mt-2 flex items-start gap-1.5 text-muted-foreground">
            <CircleCheck
              aria-hidden="true"
              className="mt-0.5 size-3.5 shrink-0 text-(--workspace-link)"
            />
            {result.text}
          </span>
        ) : null}
      </p>
      {result?.error ? (
        <p
          className="mt-2 flex items-start gap-1.5 text-xs leading-5 text-destructive"
          ref={alertRef}
          role="alert"
        >
          <CircleAlert
            aria-hidden="true"
            className="mt-0.5 size-3.5 shrink-0"
          />
          {result.text}
        </p>
      ) : null}
    </div>
  );
}
