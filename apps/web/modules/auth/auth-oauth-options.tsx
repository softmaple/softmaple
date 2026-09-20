import { GitHubIcon } from "@/components/icons/github";

export const AuthOAuthOptions = () => (
  <div className="mt-7">
    <div className="flex items-center gap-4 text-xs text-(--muted-ink)">
      <span className="h-px flex-1 bg-(--line)/65" />
      <span>Or continue with</span>
      <span className="h-px flex-1 bg-(--line)/65" />
    </div>
    <div className="mt-5 grid grid-cols-2 gap-3 max-[359px]:grid-cols-1">
      {(["GitHub", "Google"] as const).map((provider) => (
        <button
          key={provider}
          type="button"
          disabled
          aria-describedby="oauth-note"
          className="flex min-h-12 min-[56.25rem]:max-xl:min-h-[46px] cursor-default items-center justify-center gap-2 rounded-md border border-(--line) bg-(--surface)/50 px-3 text-sm text-(--muted-ink) dark:rounded-[4px]"
        >
          {provider === "GitHub" ? (
            <GitHubIcon
              aria-hidden="true"
              className="size-5 shrink-0 fill-current"
            />
          ) : (
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              className="size-5 shrink-0 fill-current"
            >
              <path d="M21.8 12.2c0-.7-.1-1.4-.2-2.1H12v4h5.5a4.7 4.7 0 0 1-2 3.1 6 6 0 1 1-3.5-10.9c1.4 0 2.7.5 3.7 1.5l3-2.9A10 10 0 1 0 12 22c5.8 0 9.8-4.1 9.8-9.8Z" />
            </svg>
          )}
          {provider}
          <span className="ml-1 rounded border border-(--line) bg-(--line)/25 px-1.5 py-0.5 text-[11px] leading-none">
            Soon
          </span>
        </button>
      ))}
    </div>
    <p
      id="oauth-note"
      className="mt-3 text-center text-xs leading-5 text-(--muted-ink) min-[56.25rem]:max-xl:leading-4"
    >
      GitHub and Google sign-in are coming soon.
    </p>
  </div>
);
