"use client";

import { type FC, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, FilePlus2, LoaderCircle } from "lucide-react";
import { Button } from "@softmaple/ui/components/button";
import { Input } from "@softmaple/ui/components/input";
import { Label } from "@softmaple/ui/components/label";
import { createDocument } from "@/app/actions/documents/documents";

export const NewDocumentForm: FC<{
  readonly workspaceSlug: string;
}> = ({ workspaceSlug }) => {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <main className="grid min-h-[calc(100dvh-4rem)] place-items-center px-4 py-12">
      <form
        className="w-full max-w-lg border bg-card p-6 shadow-sm sm:p-8"
        onSubmit={(event) => {
          event.preventDefault();
          startTransition(async () => {
            const result = await createDocument({ title, workspaceSlug });
            if (!result.ok) {
              setError(result.message);
              return;
            }
            router.replace(
              `/workspace/${workspaceSlug}/doc/${result.data.slug}`,
            );
          });
        }}
      >
        <div className="mb-8 flex items-start gap-4">
          <div className="grid size-10 shrink-0 place-items-center border bg-muted text-emphasis">
            <FilePlus2 className="size-5" />
          </div>
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-emphasis">
              New document
            </p>
            <h1 className="mt-1 font-display text-2xl font-semibold">
              Name it before the first edit.
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              The collaboration editor starts only after its durable document
              record exists.
            </p>
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="document-title">Document title</Label>
          <Input
            autoFocus
            disabled={isPending}
            id="document-title"
            maxLength={160}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Research notes"
            required
            value={title}
          />
        </div>
        {error === null ? null : (
          <p className="mt-3 text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
        <div className="mt-7 flex justify-end gap-2">
          <Button
            disabled={isPending}
            onClick={() => router.back()}
            type="button"
            variant="ghost"
          >
            Cancel
          </Button>
          <Button
            disabled={isPending || title.trim().length === 0}
            type="submit"
          >
            {isPending ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <ArrowRight className="size-4" />
            )}
            Create and edit
          </Button>
        </div>
      </form>
    </main>
  );
};
