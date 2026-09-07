import Link from "next/link";
import { Button } from "@softmaple/ui/components/button";
import { logout } from "@/app/actions/auth";
import { SoftmapleWordmark } from "@/components/BrandMark";
import { SettingsDropdown } from "@/modules/settings/settings-dropdown";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-dvh bg-background">
      <header className="border-b bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-20 max-w-7xl items-center justify-between gap-4 px-5 sm:px-8">
          <Link
            aria-label="Softmaple dashboard"
            className="inline-flex min-w-0 items-center rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
            href="/dashboard"
          >
            <SoftmapleWordmark className="text-2xl" />
          </Link>
          <div className="flex shrink-0 items-center gap-2">
            <SettingsDropdown />

            <Button
              variant="ghost"
              size="sm"
              onClick={async () => {
                "use server";
                await logout();
              }}
            >
              Sign out
            </Button>
          </div>
        </div>
      </header>

      {children}
    </div>
  );
}
