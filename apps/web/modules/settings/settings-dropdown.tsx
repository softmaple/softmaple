import Link from "next/link";
import { Settings, User, Users } from "lucide-react";

import { Button } from "@softmaple/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuItem,
} from "@softmaple/ui/components/dropdown-menu";

const settingsItems = [
  {
    key: "account",
    href: "/settings/account",
    icon: User,
    label: "Account",
  },
  {
    key: "team",
    href: "/settings/team",
    icon: Users,
    label: "Team",
  },
];

export const SettingsDropdown = () => {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon">
          <Settings className="h-4 w-4" />
          <span className="sr-only">Open settings menu</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-24">
        <DropdownMenuLabel>Settings</DropdownMenuLabel>
        <DropdownMenuSeparator />

        {settingsItems.map(({ key, href, icon: Icon, label }) => (
          <DropdownMenuItem key={key} asChild>
            <Link
              href={href}
              className="flex items-center gap-2 cursor-pointer"
            >
              <Icon className="h-4 w-4" />
              {label}
            </Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
