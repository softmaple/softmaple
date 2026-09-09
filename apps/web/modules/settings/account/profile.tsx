"use client";

import { type ChangeEvent, type FC, useState, useTransition } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  KeyRound,
  LoaderCircle,
  Trash2,
  Upload,
} from "lucide-react";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@softmaple/ui/components/avatar";
import { Button } from "@softmaple/ui/components/button";
import { Input } from "@softmaple/ui/components/input";
import { Label } from "@softmaple/ui/components/label";
import type { UsersType } from "@/types/model";
import { ModeToggle } from "@/components/mode-toggle";
import { CollaborationPreferencesPanel } from "@/components/collaboration-preferences";
import { removeAvatar, updateProfile, uploadAvatar } from "@/app/actions/users";

type ProfileRow = UsersType["Row"];

const initials = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");

export const Profile: FC<{ readonly initialProfile: ProfileRow }> = ({
  initialProfile,
}) => {
  const [profile, setProfile] = useState(initialProfile);
  const [displayName, setDisplayName] = useState(profile.full_name ?? "");
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const applyAvatar = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0];
    if (file === undefined) return;
    const formData = new FormData();
    formData.set("avatar", file);
    startTransition(async () => {
      const result = await uploadAvatar(formData);
      if (!result.ok) {
        setMessage(result.message);
        return;
      }
      setProfile(result.data);
      setMessage("Avatar updated.");
      event.target.value = "";
    });
  };

  return (
    <main className="min-h-dvh px-4 py-6 sm:px-8 sm:py-10">
      <div className="mx-auto max-w-3xl">
        <div className="flex items-center justify-between gap-3">
          <Button asChild size="sm" variant="ghost">
            <Link href="/dashboard">
              <ArrowLeft className="size-4" /> Dashboard
            </Link>
          </Button>
          <ModeToggle />
        </div>
        <div className="mt-9">
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-emphasis">
            Personal settings
          </p>
          <h1 className="mt-2 font-display text-3xl font-semibold">Account</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Your profile is visible to members of workspaces you join.
          </p>
        </div>

        {message === null ? null : (
          <p
            className="mt-6 border-l-2 border-primary bg-muted px-3 py-2 text-sm"
            role="status"
          >
            {message}
          </p>
        )}

        <CollaborationPreferencesPanel />
        <section className="mt-7 rounded-xl border bg-card p-5 sm:p-7">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
            <Avatar className="size-20 border">
              <AvatarImage
                alt={profile.avatar_alt ?? ""}
                src={profile.avatar_src ?? undefined}
              />
              <AvatarFallback className="font-display text-xl">
                {initials(profile.full_name ?? profile.email)}
              </AvatarFallback>
            </Avatar>
            <div className="flex flex-wrap gap-2">
              <Button asChild disabled={isPending} size="sm" variant="outline">
                <label>
                  {isPending ? (
                    <LoaderCircle className="size-4 animate-spin" />
                  ) : (
                    <Upload className="size-4" />
                  )}
                  Upload image
                  <input
                    accept="image/jpeg,image/png,image/webp"
                    className="sr-only"
                    disabled={isPending}
                    onChange={applyAvatar}
                    type="file"
                  />
                </label>
              </Button>
              {profile.avatar_src === null ? null : (
                <Button
                  disabled={isPending}
                  onClick={() =>
                    startTransition(async () => {
                      const result = await removeAvatar();
                      if (!result.ok) {
                        setMessage(result.message);
                        return;
                      }
                      setProfile(result.data);
                      setMessage("Avatar removed.");
                    })
                  }
                  size="sm"
                  variant="ghost"
                >
                  <Trash2 className="size-4" /> Remove
                </Button>
              )}
              <p className="w-full font-mono text-[10px] text-muted-foreground">
                JPEG, PNG, or WebP · 2 MB · 2048 × 2048 max
              </p>
            </div>
          </div>

          <form
            className="mt-8 grid gap-5"
            onSubmit={(event) => {
              event.preventDefault();
              startTransition(async () => {
                const result = await updateProfile({ displayName });
                if (!result.ok) {
                  setMessage(result.message);
                  return;
                }
                setProfile(result.data);
                setDisplayName(result.data.full_name ?? "");
                setMessage("Profile saved.");
              });
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="display-name">Display name</Label>
              <Input
                disabled={isPending}
                id="display-name"
                maxLength={80}
                onChange={(event) => setDisplayName(event.target.value)}
                required
                value={displayName}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="account-email">Email</Label>
              <Input
                disabled
                id="account-email"
                readOnly
                value={profile.email}
              />
              <p className="text-xs text-muted-foreground">
                Email changes are not available in this release.
              </p>
            </div>
            <Button
              className="w-fit"
              disabled={isPending || displayName.trim().length === 0}
              type="submit"
            >
              Save profile
            </Button>
          </form>
        </section>

        <section className="mt-5 grid gap-px border bg-border sm:grid-cols-2">
          <div className="bg-card p-5">
            <h2 className="font-display text-lg font-semibold">Appearance</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Use Light, Dark, or your system preference.
            </p>
            <div className="mt-4">
              <ModeToggle />
            </div>
          </div>
          <div className="bg-card p-5">
            <h2 className="font-display text-lg font-semibold">Password</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Send a secure reset link to your account email.
            </p>
            <Button asChild className="mt-4" size="sm" variant="outline">
              <Link href="/reset-password">
                <KeyRound className="size-4" /> Reset password
              </Link>
            </Button>
          </div>
        </section>
      </div>
    </main>
  );
};
