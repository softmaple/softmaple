import { Github } from "lucide-react";
import { Button } from "@softmaple/ui/components/button";

const GoogleMark = () => (
  <svg aria-hidden="true" className="size-4" viewBox="0 0 24 24" fill="none">
    <path
      fill="#8b8d87"
      d="M21.35 12.27c0-.74-.07-1.45-.21-2.13H12v4.03h5.23a4.47 4.47 0 0 1-1.94 2.93v2.4h3.14c1.84-1.69 2.92-4.18 2.92-7.23Z"
    />
    <path
      fill="#8b8d87"
      d="M12 21.6c2.63 0 4.84-.87 6.45-2.36l-3.14-2.4c-.87.58-1.98.92-3.31.92-2.54 0-4.7-1.72-5.47-4.03H3.28v2.48A9.74 9.74 0 0 0 12 21.6Z"
    />
    <path
      fill="#8b8d87"
      d="M6.53 13.73A5.85 5.85 0 0 1 6.22 12c0-.6.11-1.19.31-1.73V7.79H3.28A9.74 9.74 0 0 0 2.25 12c0 1.52.36 2.96 1.03 4.21l3.25-2.48Z"
    />
    <path
      fill="#8b8d87"
      d="M12 6.24c1.43 0 2.71.49 3.72 1.46l2.79-2.79C16.84 3.32 14.63 2.4 12 2.4a9.74 9.74 0 0 0-8.72 5.39l3.25 2.48C7.3 7.96 9.46 6.24 12 6.24Z"
    />
  </svg>
);

export type AuthOAuthOptionsProps = {
  readonly mode: "sign-in" | "sign-up";
};

export const AuthOAuthOptions = ({ mode }: AuthOAuthOptionsProps) => {
  const noteId = `oauth-${mode}-note`;

  return (
    <div className="mt-8">
      <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2">
        <Button
          aria-describedby={noteId}
          className="h-11 justify-between border-[#d9d6ce] bg-[#faf9f5] px-4 text-[#666862] shadow-none hover:border-[#d9d6ce] hover:bg-[#faf9f5] hover:text-[#666862] disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-100 disabled:hover:border-[#d9d6ce] disabled:hover:bg-[#faf9f5]"
          disabled
          type="button"
          variant="outline"
        >
          <span className="flex items-center gap-2">
            <Github className="size-4 text-[#8b8d87]" /> GitHub
          </span>
          <span className="rounded-full bg-[#eeece6] px-2 py-0.5 text-[10px] font-normal text-[#797b75]">
            Soon
          </span>
        </Button>
        <Button
          aria-describedby={noteId}
          className="h-11 justify-between border-[#d9d6ce] bg-[#faf9f5] px-4 text-[#666862] shadow-none hover:border-[#d9d6ce] hover:bg-[#faf9f5] hover:text-[#666862] disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-100 disabled:hover:border-[#d9d6ce] disabled:hover:bg-[#faf9f5]"
          disabled
          type="button"
          variant="outline"
        >
          <span className="flex items-center gap-2">
            <GoogleMark /> Google
          </span>
          <span className="rounded-full bg-[#eeece6] px-2 py-0.5 text-[10px] font-normal text-[#797b75]">
            Soon
          </span>
        </Button>
      </div>
      <p className="mt-3 text-xs leading-5 text-[#777973]" id={noteId}>
        GitHub and Google sign-in are coming soon.
      </p>
      <div className="relative mt-6">
        <div className="absolute inset-0 flex items-center">
          <span className="w-full border-t" />
        </div>
        <div className="relative flex justify-center text-xs">
          <span className="bg-[var(--auth-paper)] px-3 text-[#777973]">or</span>
        </div>
      </div>
    </div>
  );
};
