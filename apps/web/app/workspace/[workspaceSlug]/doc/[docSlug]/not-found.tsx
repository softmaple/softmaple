"use client";

import { Button } from "@softmaple/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@softmaple/ui/components/card";
import { FileX, Home, ArrowLeft, Search } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";

export default function DocNotFoundPage() {
  const params = useParams();
  const { workspaceSlug, docSlug } = params;

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-muted/30">
      <Card className="w-full max-w-md text-center">
        <CardHeader className="pb-4">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted">
            <FileX className="h-8 w-8 text-muted-foreground" />
          </div>
          <CardTitle className="text-2xl font-semibold">
            Document Not Found
          </CardTitle>
          <CardDescription className="text-base">
            {docSlug
              ? `The document "${docSlug}" could not be found. It may have been deleted or moved.`
              : "The document you're looking for doesn't exist or has been removed."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-3">
            {/*{onGoBack && (*/}
            {/*  <Button onClick={onGoBack} variant="default" className="w-full">*/}
            {/*    <ArrowLeft className="mr-2 h-4 w-4" />*/}
            {/*    Go Back*/}
            {/*  </Button>*/}
            {/*)}*/}

            <Button asChild variant="outline" className="w-full">
              <Link href="/dashboard">
                <Home className="mr-2 h-4 w-4" />
                Return to Dashboard
              </Link>
            </Button>

            <Button asChild variant="ghost" className="w-full">
              <Link href={`/workspace/${workspaceSlug}`}>
                <Search className="mr-2 h-4 w-4" />
                Browse All Documents
              </Link>
            </Button>
          </div>

          <div className="pt-4 border-t">
            <p className="text-sm text-muted-foreground">
              Need help?{" "}
              <Link href="/support" className="text-primary hover:underline">
                Contact support
              </Link>
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
