import { FileText } from "lucide-react";
import { Button } from "@softmaple/ui/components/button";
import { logout } from "@/app/actions/auth";
import { SettingsDropdown } from "@/modules/settings/settings-dropdown";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <div className="w-8 h-8 bg-gradient-to-br from-orange-500 to-red-500 rounded-lg flex items-center justify-center">
              <FileText className="w-5 h-5 text-white" />
            </div>
            <span className="font-semibold text-xl">Softmaple</span>
          </div>
          <div className="flex items-center space-x-4">
            <SettingsDropdown />

            <Button
              variant="ghost"
              size="sm"
              onClick={async () => {
                "use server";
                await logout();
              }}
            >
              Logout
            </Button>
          </div>
        </div>
      </header>

      {children}
    </div>
  );
}
