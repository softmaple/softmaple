"use client";

import * as React from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

import { Button } from "@softmaple/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@softmaple/ui/components/dropdown-menu";

// Phones get full 44px targets; pointer layouts keep the compact size.
const itemClass = "max-md:min-h-11";

export function ModeToggle() {
  const { setTheme } = useTheme();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="max-md:size-11"
        >
          <Sun className="h-[1.2rem] w-[1.2rem] rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
          <Moon className="absolute h-[1.2rem] w-[1.2rem] rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
          <span className="sr-only">Toggle theme</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          className={itemClass}
          onClick={() => setTheme("light")}
        >
          <Sun aria-hidden="true" />
          Light
        </DropdownMenuItem>
        <DropdownMenuItem
          className={itemClass}
          onClick={() => setTheme("dark")}
        >
          <Moon aria-hidden="true" />
          Dark
        </DropdownMenuItem>
        <DropdownMenuItem
          className={itemClass}
          onClick={() => setTheme("system")}
        >
          <Monitor aria-hidden="true" />
          System
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
