"use client";

import { type ChangeEvent, type FC, useState, useTransition } from "react";
import Link from "next/link";
import { ArrowLeft, LoaderCircle, Trash2, Upload } from "lucide-react";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@softmaple/ui/components/avatar";
import { Button } from "@softmaple/ui/components/button";
import { Input } from "@softmaple/ui/components/input";
import { Label } from "@softmaple/ui/components/label";
import { cn } from "@softmaple/ui/lib/utils";
import type { UsersType } from "@/types/model";
import { removeAvatar, updateProfile, uploadAvatar } from "@/app/actions/users";
import {
  BrushUnderline,
  PaperEntrance,
  PaperFeedback,
  type PaperFeedbackMessage,
} from "@/modules/workspaces/workspace-paper";
import {
  paperFieldRow,
  paperPanel,
  paperSerif,
} from "@/modules/workspaces/workspace-paper-styles";
import { PasswordReset } from "./password-reset";
import { ThemeChoice } from "./theme-choice";

type ProfileRow = UsersType["Row"];

const initials = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");

const sectionTitle = `${paperSerif} mb-2 text-xl tracking-tight`;

export const Profile: FC<{
  readonly initialProfile: ProfileRow;
  /** Why the reset link that sent the person here didn't work. */
  readonly resetLinkError?: string;
}> = ({ initialProfile, resetLinkError }) => {
  const [profile, setProfile] = useState(initialProfile);
  const [displayName, setDisplayName] = useState(profile.full_name ?? "");
  const [feedback, setFeedback] = useState<PaperFeedbackMessage | null>(null);
  const [isSaving, startSaving] = useTransition();
  const [isUpdatingAvatar, startAvatarUpdate] = useTransition();
  const isPending = isSaving || isUpdatingAvatar;
  const dirty = displayName !== (profile.full_name ?? "");
  const valid = displayName.trim().length > 0;
  // Profiles can start without a name; only flag it once the person edits.
  const nameError = dirty && !valid;

  const applyAvatar = (event: ChangeEvent<HTMLInputElement>): void => {
    const input = event.target;
    const file = input.files?.[0];
    if (file === undefined) return;
    const formData = new FormData();
    formData.set("avatar", file);
    setFeedback(null);
    startAvatarUpdate(async () => {
      try {
        const result = await uploadAvatar(formData);
        if (!result.ok) {
          setFeedback({ error: true, text: result.message });
          return;
        }
        setProfile(result.data);
        setFeedback({ error: false, text: "Avatar updated." });
      } catch {
        setFeedback({
          error: true,
          text: "Could not upload your image. Try again.",
        });
      } finally {
        // Selecting the same file again must still fire a change event.
        input.value = "";
      }
    });
  };

  const clearAvatar = (): void => {
    setFeedback(null);
    startAvatarUpdate(async () => {
      try {
        const result = await removeAvatar();
        if (!result.ok) {
          setFeedback({ error: true, text: result.message });
          return;
        }
        setProfile(result.data);
        setFeedback({ error: false, text: "Avatar removed." });
      } catch {
        setFeedback({
          error: true,
          text: "Could not remove your image. Try again.",
        });
      }
    });
  };

  return (
    <main className="mx-auto w-full max-w-3xl px-5 pb-[max(4rem,env(safe-area-inset-bottom))] pt-4 sm:px-8 md:pt-6">
      <Link
        href="/dashboard"
        className="-ml-1 inline-flex min-h-11 items-center gap-2 rounded-sm px-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        All workspaces
      </Link>
      <PaperEntrance>
        <div className="mb-6 mt-2">
          <h1
            className={`${paperSerif} text-4xl leading-tight tracking-tight md:font-medium`}
          >
            <BrushUnderline>Account</BrushUnderline> settings
          </h1>
          <p className="mt-3 text-sm text-muted-foreground">
            Your profile is visible to members of workspaces you join.
          </p>
        </div>

        <PaperFeedback className="mb-4" feedback={feedback} />

        <section aria-labelledby="profile-title">
          <h2 className={sectionTitle} id="profile-title">
            Profile
          </h2>
          <div className={paperPanel}>
            <div className={paperFieldRow}>
              <div>
                <p className="text-sm font-semibold">Avatar</p>
                <p className="mt-1 hidden text-xs text-muted-foreground md:block">
                  Shown beside your name across workspaces.
                </p>
              </div>
              <div className="flex items-center gap-5">
                <Avatar className="size-16 border border-border">
                  <AvatarImage
                    alt={profile.avatar_alt ?? ""}
                    className="object-cover"
                    src={profile.avatar_src ?? undefined}
                  />
                  <AvatarFallback
                    className={`${paperSerif} bg-secondary text-xl text-secondary-foreground`}
                  >
                    {initials(profile.full_name ?? profile.email)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <div className="flex flex-wrap gap-2">
                    <Button
                      asChild
                      className={cn(
                        "h-11 cursor-pointer md:h-9",
                        "has-[:focus-visible]:border-ring has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50",
                        isPending && "pointer-events-none opacity-50",
                      )}
                      variant="outline"
                    >
                      <label>
                        {isUpdatingAvatar ? (
                          <LoaderCircle
                            aria-hidden="true"
                            className="animate-spin"
                          />
                        ) : (
                          <Upload aria-hidden="true" />
                        )}
                        Upload image
                        <input
                          accept="image/jpeg,image/png,image/webp"
                          aria-describedby="avatar-hint"
                          className="sr-only"
                          disabled={isPending}
                          onChange={applyAvatar}
                          type="file"
                        />
                      </label>
                    </Button>
                    {profile.avatar_src === null ? null : (
                      <Button
                        className="h-11 md:h-9"
                        disabled={isPending}
                        onClick={clearAvatar}
                        type="button"
                        variant="ghost"
                      >
                        <Trash2 data-icon="inline-start" />
                        Remove
                      </Button>
                    )}
                  </div>
                  <p
                    className="mt-2 text-xs text-muted-foreground"
                    id="avatar-hint"
                  >
                    JPEG, PNG, or WebP, up to 2 MB and 2048 × 2048 px.
                  </p>
                </div>
              </div>
            </div>
            <form
              id="profile-form"
              onSubmit={(event) => {
                event.preventDefault();
                if (!dirty || !valid || isPending) return;
                setFeedback(null);
                startSaving(async () => {
                  try {
                    const result = await updateProfile({ displayName });
                    if (!result.ok) {
                      setFeedback({ error: true, text: result.message });
                      return;
                    }
                    setProfile(result.data);
                    setDisplayName(result.data.full_name ?? "");
                    setFeedback({ error: false, text: "Profile saved." });
                  } catch {
                    setFeedback({
                      error: true,
                      text: "Could not save your profile. Try again.",
                    });
                  }
                });
              }}
            >
              <div className={paperFieldRow}>
                <Label
                  className="self-start pt-1 text-sm font-semibold"
                  htmlFor="display-name"
                >
                  Display name
                </Label>
                <div>
                  <Input
                    aria-describedby={
                      nameError ? "display-name-error" : undefined
                    }
                    aria-invalid={nameError}
                    autoComplete="name"
                    className="h-11 md:h-8"
                    disabled={isPending}
                    id="display-name"
                    maxLength={80}
                    onChange={(event) => setDisplayName(event.target.value)}
                    required
                    value={displayName}
                  />
                  {nameError ? (
                    <p
                      className="mt-1 text-xs text-destructive"
                      id="display-name-error"
                    >
                      Display name is required.
                    </p>
                  ) : null}
                </div>
              </div>
              <div className={paperFieldRow}>
                <div>
                  <Label
                    className="text-sm font-semibold"
                    htmlFor="account-email"
                  >
                    Email
                  </Label>
                  <p className="mt-1 hidden text-xs text-muted-foreground md:block">
                    Used to log in and to add you to workspaces.
                  </p>
                </div>
                <div>
                  <Input
                    aria-describedby="account-email-hint"
                    className="h-11 bg-muted/50 text-muted-foreground md:h-8 dark:bg-muted/50"
                    id="account-email"
                    readOnly
                    value={profile.email}
                  />
                  <p
                    className="mt-1 text-xs text-muted-foreground"
                    id="account-email-hint"
                  >
                    Email changes aren’t available yet.
                  </p>
                </div>
              </div>
            </form>
          </div>
          <div className="flex gap-2 py-3 md:justify-end">
            <Button
              className="h-11 flex-1 md:h-9 md:min-w-24 md:flex-none"
              disabled={!dirty || isPending}
              onClick={() => setDisplayName(profile.full_name ?? "")}
              type="button"
              variant="outline"
            >
              Cancel
            </Button>
            <Button
              className="h-11 flex-[1.5] md:h-9 md:min-w-36 md:flex-none"
              disabled={!dirty || !valid || isPending}
              form="profile-form"
              type="submit"
            >
              {isSaving ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </section>

        <section aria-labelledby="preferences-title" className="mt-6">
          <h2 className={sectionTitle} id="preferences-title">
            Preferences
          </h2>
          <div className={paperPanel}>
            <div className={paperFieldRow}>
              <div>
                <p className="text-sm font-semibold" id="appearance-label">
                  Appearance
                </p>
                <p className="mt-1 hidden text-xs text-muted-foreground md:block">
                  Use light, dark, or match your system.
                </p>
              </div>
              <ThemeChoice labelledBy="appearance-label" />
            </div>
            <div className={paperFieldRow}>
              <div>
                <p className="text-sm font-semibold">Password</p>
                <p className="mt-1 hidden text-xs text-muted-foreground md:block">
                  We’ll email a reset link to {profile.email}.
                </p>
              </div>
              <PasswordReset initialError={resetLinkError} />
            </div>
          </div>
        </section>
      </PaperEntrance>
    </main>
  );
};
