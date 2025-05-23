import type { FC, ReactNode } from "react";

import { NetlifyBadge } from "@/layout/NetlifyBadge.tsx";

type LayoutProps = {
  children: ReactNode;
};

export const Layout: FC<LayoutProps> = (props) => {
  const { children } = props;

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b sticky top-0 z-10 bg-white">
        <div className="container mx-auto px-4 py-3 flex justify-between items-center">
          <h1 className="text-xl font-bold">Softmaple</h1>
        </div>
      </header>

      <main className="flex-1 container mx-auto px-4 py-6">{children}</main>

      <footer className="border-t py-4">
        <div className="container mx-auto px-4 flex justify-between items-center">
          <div>
            <NetlifyBadge />
          </div>
          <div className="text-sm text-gray-500">
            © {new Date().getFullYear()} Softmaple
          </div>
        </div>
      </footer>

      {/* TODO: implement it */}
      {/*<GitHubCorner repoUrl="https://github.com/softmaple/softmaple" />*/}
    </div>
  );
};
