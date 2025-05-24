import type { FC, ReactNode } from "react";

import { NetlifyBadge } from "@/layout/NetlifyBadge.tsx";
import { ThemeModeToggle } from "@/components/ui/theme-mode-toggle.tsx";

type LayoutProps = {
  children: ReactNode;
};

export const Layout: FC<LayoutProps> = (props) => {
  const { children } = props;

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b sticky top-0 z-10 bg-white dark:bg-black shadow-sm">
        <div className="container mx-auto px-4 py-3 flex justify-between items-center">
          <h1 className="text-xl font-bold">Softmaple</h1>

          <ThemeModeToggle />
        </div>
      </header>

      <main className="flex-1 container mx-auto px-4 py-6">{children}</main>

      <footer className="border-t py-4">
        <div className="container mx-auto px-4 flex justify-between items-center">
          <div className="flex items-center space-x-2 text-sm text-gray-500">
            <NetlifyBadge />
            {/* shadcn footer */}
            <p>
              Built by&nbsp;
              <a
                href={"https://twitter.com/shadcn"}
                target="_blank"
                className="font-medium underline underline-offset-4"
              >
                shadcn
              </a>
              . The source code is available on&nbsp;
              <a
                href={"https://github.com/softmaple/softmaple"}
                target="_blank"
                className="font-medium underline underline-offset-4"
              >
                GitHub
              </a>
              .
            </p>
          </div>
          <div className="text-sm text-gray-500">
            © {new Date().getFullYear()} Softmaple
          </div>
        </div>
      </footer>
    </div>
  );
};
