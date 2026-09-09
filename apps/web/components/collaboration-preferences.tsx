"use client";

import { useEffect, useState } from "react";
import {
  useCollaborationPreferences,
  updateCollaborationPreferences,
} from "@/lib/collaboration-preferences";

export function MotionPreference() {
  const { reducedMotion } = useCollaborationPreferences();
  useEffect(() => {
    document.documentElement.dataset.reducedMotion = String(reducedMotion);
    return () => {
      delete document.documentElement.dataset.reducedMotion;
    };
  }, [reducedMotion]);
  return null;
}

export function CollaborationPreferencesPanel() {
  const preferences = useCollaborationPreferences();
  const [failed, setFailed] = useState(false);
  return (
    <section
      className="mt-7 rounded-xl border bg-card p-5 sm:p-7"
      aria-labelledby="collaboration-preferences"
    >
      <h2 id="collaboration-preferences" className="text-lg font-semibold">
        Collaboration and accessibility
      </h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Preferences for this browser. Your workspace permissions stay the same.
      </p>
      <div className="mt-5 divide-y">
        {(
          [
            [
              "focusMode",
              "Focus mode",
              "Quiet ambient activity while keeping direct invitations retrievable. Other people can still see you.",
            ],
            [
              "shareLocation",
              "Share detailed location",
              "Let collaborators see your caret and section in shared documents. Your membership remains visible.",
            ],
            [
              "reducedMotion",
              "Reduce motion",
              "Use immediate state changes. Your system’s reduced-motion preference is always respected.",
            ],
          ] as const
        ).map(([key, title, description]) => (
          <label
            key={key}
            className="flex min-h-20 cursor-pointer items-start gap-4 py-4"
          >
            <span className="flex-1">
              <span className="block text-sm font-medium">{title}</span>
              <span className="mt-1 block max-w-lg text-sm text-muted-foreground">
                {description}
              </span>
            </span>
            <span className="grid size-11 shrink-0 place-items-center">
              <input
                className="size-5 accent-foreground"
                type="checkbox"
                checked={preferences[key]}
                onChange={(event) =>
                  setFailed(
                    !updateCollaborationPreferences({
                      [key]: event.target.checked,
                    }),
                  )
                }
              />
            </span>
          </label>
        ))}
      </div>
      {failed ? (
        <p role="alert" className="text-sm text-destructive">
          Your browser could not save this preference. Allow local storage and
          try again.
        </p>
      ) : null}
    </section>
  );
}
