"use client";

import { useState, useEffect } from "react";
import { useMediaQuery } from "@/hooks/use-media-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";

export default function PlaygroundPage() {
  const [isMounted, setIsMounted] = useState(false);
  const isMobile = useMediaQuery("(max-width: 768px)");

  // Prevent hydration errors
  useEffect(() => {
    setIsMounted(true);
  }, []);

  if (!isMounted) {
    return null;
  }

  return (
    <div className="h-screen w-full flex flex-col">
      <header className="border-b p-4">
        <h1 className="text-xl font-bold">Playground</h1>
      </header>

      {isMobile ? (
        <Tabs defaultValue="editor" className="flex-1 flex flex-col">
          <div className="border-b px-4">
            <TabsList className="my-2">
              <TabsTrigger value="editor">Editor</TabsTrigger>
              <TabsTrigger value="preview">Preview</TabsTrigger>
            </TabsList>
          </div>
          <TabsContent value="editor" className="flex-1 p-4 overflow-auto">
            <div className="h-full w-full border rounded-md bg-muted/30 flex items-center justify-center">
              <p className="text-muted-foreground">Editor Panel</p>
            </div>
          </TabsContent>
          <TabsContent value="preview" className="flex-1 p-4 overflow-auto">
            <div className="h-full w-full border rounded-md bg-background flex items-center justify-center">
              <p className="text-muted-foreground">Preview Panel</p>
            </div>
          </TabsContent>
        </Tabs>
      ) : (
        <ResizablePanelGroup direction="horizontal" className="flex-1">
          <ResizablePanel defaultSize={50} minSize={30}>
            <div className="h-full p-4 overflow-auto">
              <div className="h-full w-full border rounded-md bg-muted/30 flex items-center justify-center">
                <p className="text-muted-foreground">Editor Panel</p>
              </div>
            </div>
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel defaultSize={50} minSize={30}>
            <div className="h-full p-4 overflow-auto">
              <div className="h-full w-full border rounded-md bg-background flex items-center justify-center">
                <p className="text-muted-foreground">Preview Panel</p>
              </div>
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      )}
    </div>
  );
}
