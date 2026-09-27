import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronRight,
  Mail,
  Settings,
  ShieldCheck,
  Users,
  X,
} from "lucide-react";
import { Button } from "@softmaple/ui/components/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from "@softmaple/ui/components/sheet";
import { cn } from "@softmaple/ui/lib/utils";
import { MapleMark } from "@/components/landing/Brand";
import { paperSerif, paperSurface } from "../workspace-paper";

const categories = [
  { id: "general", label: "General", icon: Settings },
  { id: "members", label: "Members", icon: Users },
  { id: "invitations", label: "Invitations", icon: Mail, unavailable: true },
  {
    id: "permissions",
    label: "Permissions",
    icon: ShieldCheck,
    unavailable: true,
  },
] as const;

type NavigationProps = {
  initialTab: "general" | "members";
  memberCount: number;
  workspaceHref: string;
  onNavigate: () => void;
};

export function SettingsNavigation({
  initialTab,
  memberCount,
  workspaceHref,
  onNavigate,
  mobile = false,
}: NavigationProps & { mobile?: boolean }) {
  return (
    <nav
      aria-label={mobile ? "Settings categories" : "Workspace settings"}
      className="flex flex-col gap-1"
    >
      {categories.map((item) => {
        const Icon = item.icon;
        const selected = item.id === initialTab;
        const unavailable = "unavailable" in item;
        const content = (
          <>
            <Icon className="size-5 shrink-0" />
            <span className="flex-1">{item.label}</span>
            {item.id === "members" ? (
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs">
                {memberCount}
              </span>
            ) : null}
            {unavailable ? (
              <span className="text-[10px] font-sans text-muted-foreground">
                Soon
              </span>
            ) : mobile ? (
              selected ? (
                <Check className="size-5" />
              ) : (
                <ChevronRight className="size-4 text-muted-foreground" />
              )
            ) : null}
          </>
        );
        const className = cn(
          "flex min-h-11 items-center gap-3 rounded-md px-3 py-2 text-left text-sm",
          mobile && `${paperSerif} min-h-12 px-4 text-lg`,
          selected
            ? "bg-secondary text-secondary-foreground"
            : "hover:bg-accent",
          unavailable && "cursor-not-allowed opacity-60",
        );
        return unavailable ? (
          <button
            key={item.id}
            disabled
            className={className}
            title={`${item.label} are coming soon`}
          >
            {content}
          </button>
        ) : (
          <Link
            key={item.id}
            className={className}
            aria-current={selected ? "page" : undefined}
            href={`${workspaceHref}/settings${item.id === "members" ? "?tab=members" : ""}`}
            onClick={() => {
              onNavigate();
            }}
          >
            {content}
          </Link>
        );
      })}
    </nav>
  );
}

export function MobileSettingsNavigation({
  title,
  ...props
}: NavigationProps & { title: string }) {
  const { initialTab, memberCount, workspaceHref, onNavigate } = props;
  const [sheetOpen, setSheetOpen] = useState(false);
  const category =
    categories.find((item) => item.id === initialTab) ?? categories[0];
  const CategoryIcon = category.icon;
  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 768px)");
    const close = () => {
      if (desktop.matches) setSheetOpen(false);
    };
    desktop.addEventListener("change", close);
    return () => desktop.removeEventListener("change", close);
  }, []);
  return (
    <div className="md:hidden">
      <div className="flex min-h-11 items-center gap-5">
        <span className="w-6 shrink-0">
          <MapleMark />
        </span>
        <p className="truncate text-sm">{title}</p>
      </div>
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetTrigger asChild>
          <Button className="h-12 w-full justify-start gap-4" variant="outline">
            <CategoryIcon />
            {category.label}
            <ChevronDown className="ml-auto" />
          </Button>
        </SheetTrigger>
        <SheetContent
          side="bottom"
          className={`${paperSurface} gap-2 rounded-t-3xl px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]`}
        >
          <div className="flex items-start px-2 pb-2 pt-3">
            <div className="min-w-0">
              <SheetTitle
                className={`${paperSerif} text-2xl font-normal tracking-tight`}
              >
                Workspace settings
              </SheetTitle>
              <SheetDescription className="mt-1 truncate">
                {title}
              </SheetDescription>
            </div>
            <SheetClose asChild>
              <Button
                size="icon"
                variant="ghost"
                className="ml-auto min-h-11 min-w-11"
                aria-label="Close settings navigation"
              >
                <X />
              </Button>
            </SheetClose>
          </div>
          <SettingsNavigation
            initialTab={initialTab}
            memberCount={memberCount}
            workspaceHref={workspaceHref}
            mobile
            onNavigate={() => {
              onNavigate();
              setSheetOpen(false);
            }}
          />
          <Link
            href={workspaceHref}
            onClick={() => setSheetOpen(false)}
            className={`${paperSerif} mx-2 mt-4 flex min-h-16 items-center gap-5 border-t border-border px-2 pt-2 text-lg`}
          >
            <ArrowLeft className="size-5" />
            Back to workspace
          </Link>
        </SheetContent>
      </Sheet>
    </div>
  );
}
