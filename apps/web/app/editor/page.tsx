"use client";

import { Button } from "@softmaple/ui/components/button";
import Link from "next/link";

export default function EditorPage() {
  return (
    <div className="flex flex-col min-h-screen">
      <header className="p-4 border-b">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">SoftMaple Editor</h1>
          <Link href="/">
            <Button variant="outline" size="sm">
              Back to Home
            </Button>
          </Link>
        </div>
      </header>
      <main className="flex-1">
        <iframe
          src="/editor/index.html"
          className="w-full h-full min-h-[calc(100vh-80px)]"
          title="SoftMaple Editor"
        />
      </main>
    </div>
  );
}
