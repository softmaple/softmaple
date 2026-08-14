import type { FC, ReactNode } from "react";
import { SITE_CONFIG } from "@softmaple/config";

import { ThemeModeToggle } from "@softmaple/editor/components/ui/theme-mode-toggle";

type LayoutProps = {
  children: ReactNode;
};

export const Layout: FC<LayoutProps> = (props) => {
  const { children } = props;

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b sticky top-0 z-10 bg-background shadow-sm">
        <div className="container mx-auto px-4 py-3 flex justify-between items-center">
          <h1 className="text-xl font-bold">Softmaple</h1>

          <ThemeModeToggle />
        </div>
      </header>

      <main className="flex-1 container mx-auto px-4 py-6">{children}</main>

      <footer className="border-t py-4">
        <div className="container mx-auto px-4 flex justify-between items-center flex-col md:flex-row">
          <p className="text-sm text-gray-500">
            The source code is available on&nbsp;
            <a
              href={SITE_CONFIG.GITHUB_REPO}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium underline underline-offset-4"
            >
              GitHub
            </a>
            .
          </p>
          <div className="text-sm text-gray-500">
            © {new Date().getFullYear()} Softmaple
          </div>
        </div>
      </footer>
    </div>
  );
};
