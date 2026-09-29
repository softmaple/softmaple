"use client";

import { type ReactNode, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ActionResult } from "@/lib/actions/result";
import type { AuthActionData } from "@/app/actions/auth";
import Link from "next/link";
import { domAnimation, LazyMotion, m, useReducedMotion } from "motion/react";
import {
  CircleAlert,
  CircleCheck,
  ChevronDown,
  LogOut,
  Settings,
  UserRound,
} from "lucide-react";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@softmaple/ui/components/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@softmaple/ui/components/dropdown-menu";
import { cn } from "@softmaple/ui/lib/utils";
import { MapleMark } from "@/components/landing/Brand";
import { ModeToggle } from "@/components/mode-toggle";

import { paperSerif, paperSurface } from "./workspace-paper-styles";
export { paperSurface, paperSerif } from "./workspace-paper-styles";
export type WorkspaceProfile = {
  full_name: string | null;
  avatar_src: string | null;
};
export type PaperFeedbackMessage = {
  readonly error: boolean;
  readonly text: string;
};

/**
 * Inline result of a settings action. The polite status region stays mounted
 * (and empty, so it takes no space) because screen readers often skip live
 * regions that arrive already filled; errors are inserted as alerts. Render
 * one per view so `role="status"` stays unique.
 */
export function PaperFeedback({
  feedback,
  className,
}: {
  readonly feedback: PaperFeedbackMessage | null;
  readonly className?: string;
}) {
  const base = "flex items-start gap-2.5 rounded-md border p-3 text-sm";
  return (
    <>
      <div role="status">
        {feedback !== null && !feedback.error ? (
          <p className={cn(base, "border-border bg-card/70", className)}>
            <CircleCheck
              aria-hidden="true"
              className="mt-0.5 size-4 shrink-0 text-(--workspace-link)"
            />
            {feedback.text}
          </p>
        ) : null}
      </div>
      {feedback?.error ? (
        <p
          role="alert"
          className={cn(
            base,
            "border-destructive/50 bg-destructive/5 text-destructive",
            className,
          )}
        >
          <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {feedback.text}
        </p>
      ) : null}
    </>
  );
}

export function WorkspaceBrand() {
  return (
    <span
      className={cn(
        paperSerif,
        "inline-flex items-center gap-2 text-2xl tracking-tight [&_svg]:h-8 [&_svg]:w-7",
      )}
    >
      <MapleMark />
      softmaple
    </span>
  );
}
export function WorkspaceAccount({
  profile,
  signOut,
}: {
  profile?: WorkspaceProfile;
  signOut?: () => Promise<ActionResult<AuthActionData>>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const initials = (profile?.full_name ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
  const content = (
    <>
      <Avatar className="size-8">
        <AvatarImage src={profile?.avatar_src ?? undefined} alt="" />
        <AvatarFallback className="text-xs">
          {initials || <UserRound className="size-4" />}
        </AvatarFallback>
      </Avatar>
      {profile ? (
        <span className="hidden max-w-28 truncate text-xs md:inline">
          {profile.full_name?.split(" ")[0]}
        </span>
      ) : null}
    </>
  );
  const className =
    "flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-full";
  if (!signOut)
    return (
      <Link
        href="/settings/account"
        aria-label="Your account"
        className={className}
      >
        {content}
      </Link>
    );
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={className} aria-label="Your account">
        {content}
        <ChevronDown className="hidden size-3 md:block" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className={cn(paperSurface, "w-56")}>
        {profile?.full_name ? (
          <>
            <DropdownMenuLabel className="truncate font-normal text-muted-foreground">
              Signed in as{" "}
              <span className="font-medium text-foreground">
                {profile.full_name}
              </span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
          </>
        ) : null}
        <DropdownMenuGroup>
          <DropdownMenuItem asChild className="max-md:min-h-11">
            <Link href="/settings/account">
              <Settings aria-hidden="true" />
              Account settings
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem
            className="max-md:min-h-11"
            disabled={pending}
            onSelect={(event) => {
              event.preventDefault();
              startTransition(async () => {
                try {
                  const result = await signOut();
                  if (!result.ok) {
                    setError(result.message);
                    return;
                  }
                  router.replace(result.data.redirectTo ?? "/");
                  router.refresh();
                } catch {
                  setError("Could not log out. Try again.");
                }
              });
            }}
          >
            <LogOut aria-hidden="true" />
            {pending ? "Logging out…" : "Log out"}
          </DropdownMenuItem>
          {error ? (
            <p role="alert" className="max-w-52 p-2 text-xs text-destructive">
              {error}
            </p>
          ) : null}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
export function WorkspaceHeader({
  profile,
  children,
  signOut,
}: {
  signOut?: () => Promise<ActionResult<AuthActionData>>;
  profile?: WorkspaceProfile;
  children?: ReactNode;
}) {
  return (
    <header className="border-b border-border pt-[env(safe-area-inset-top)]">
      <div className="mx-auto flex min-h-16 max-w-6xl items-center gap-6 px-5 sm:px-8">
        <Link
          href="/dashboard"
          aria-label="Softmaple dashboard"
          className="inline-flex min-h-11 items-center"
        >
          <WorkspaceBrand />
        </Link>
        {children}
        <div className="ml-auto flex items-center gap-3">
          <ModeToggle />
          <WorkspaceAccount profile={profile} signOut={signOut} />
        </div>
      </div>
    </header>
  );
}
export function BrushUnderline({ children }: { children: ReactNode }) {
  return (
    <span className="relative isolate inline-block after:pointer-events-none after:absolute after:-bottom-2 after:-left-1 after:-z-1 after:h-4 after:w-full after:bg-[url('/loading/brush.svg')] after:bg-size-[100%_100%] after:bg-no-repeat after:content-['']">
      {children}
    </span>
  );
}
export function PaperEntrance({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const reduced = useReducedMotion();
  return (
    <LazyMotion features={domAnimation}>
      <m.div
        className={className}
        initial={{ opacity: 1 }}
        animate={{ opacity: 1 }}
        transition={{ duration: reduced ? 0 : 0.16, ease: "easeOut" }}
      >
        {children}
      </m.div>
    </LazyMotion>
  );
}
export function WorkspaceIcon({
  title,
  src,
  className,
}: {
  title: string;
  src?: string | null;
  className?: string;
}) {
  return (
    <Avatar className={cn("size-16 shrink-0 rounded-lg", className)}>
      <AvatarImage className="object-cover" src={src ?? undefined} alt="" />
      <AvatarFallback className="rounded-lg bg-(--workspace-icon) text-primary-foreground [&_svg]:size-9 [&_svg]:text-current">
        <span className="sr-only">{title}</span>
        <MapleMark />
      </AvatarFallback>
    </Avatar>
  );
}
