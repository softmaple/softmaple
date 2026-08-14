import { Github, Mail } from "lucide-react";
import { Button } from "@softmaple/ui/components/button";

export type AuthOAuthOptionsProps = {
  readonly mode: "sign-in" | "sign-up";
};

export const AuthOAuthOptions = ({ mode }: AuthOAuthOptionsProps) => {
  const noteId = `oauth-${mode}-note`;

  return (
    <div className="mt-7">
      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <span className="w-full border-t" />
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-card px-2 text-muted-foreground">
            Or continue with
          </span>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3 sm:gap-4">
        <Button aria-describedby={noteId} disabled variant="outline">
          <Github className="size-4" /> GitHub
        </Button>
        <Button aria-describedby={noteId} disabled variant="outline">
          <Mail className="size-4" /> Google
        </Button>
      </div>
      <p className="mt-3 text-center text-xs text-muted-foreground" id={noteId}>
        GitHub and Google {mode} are coming soon.
      </p>
    </div>
  );
};
