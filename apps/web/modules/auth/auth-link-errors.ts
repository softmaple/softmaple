/**
 * Codes the auth link routes put in `?error=`. Pages show the fixed copy for
 * a code and never render text taken from the URL, so a crafted link can't
 * speak in the app's voice.
 */
export const AUTH_LINK_ERROR = {
  LinkInvalid: "link_invalid",
  ResetLinkInvalid: "reset_link_invalid",
  ResetLinkOtherBrowser: "reset_link_other_browser",
  SignInFailed: "sign_in_failed",
} as const;

export type AuthLinkError =
  (typeof AUTH_LINK_ERROR)[keyof typeof AUTH_LINK_ERROR];

const COPY: Readonly<Record<AuthLinkError, string>> = {
  [AUTH_LINK_ERROR.LinkInvalid]: "This link has expired or was already used.",
  [AUTH_LINK_ERROR.ResetLinkInvalid]:
    "This reset link has expired or was already used. Request a new one.",
  [AUTH_LINK_ERROR.ResetLinkOtherBrowser]:
    "This reset link was opened in a different browser from the one that requested it. Request a new one here, then open it in this browser.",
  [AUTH_LINK_ERROR.SignInFailed]: "We couldn’t log you in. Try again.",
};

const FALLBACK = "Something went wrong. Try again.";

const RESET_LINK_ERRORS: ReadonlySet<AuthLinkError> = new Set([
  AUTH_LINK_ERROR.ResetLinkInvalid,
  AUTH_LINK_ERROR.ResetLinkOtherBrowser,
]);

const isAuthLinkError = (value: string): value is AuthLinkError =>
  Object.hasOwn(COPY, value);

/** Reset failures land where a new link can be requested; others on login. */
export const authLinkErrorPath = (error: AuthLinkError): string =>
  `${RESET_LINK_ERRORS.has(error) ? "/reset-password" : "/login"}?error=${error}`;

/** Copy for an `?error=` value. Unknown values get a generic line. */
export const authLinkErrorMessage = (
  value: string | undefined,
): string | undefined => {
  if (value === undefined) return undefined;
  return isAuthLinkError(value) ? COPY[value] : FALLBACK;
};

/** The `?error=` value when it is a reset-link failure, else undefined. */
export const resetLinkError = (
  value: string | undefined,
): AuthLinkError | undefined =>
  value !== undefined && isAuthLinkError(value) && RESET_LINK_ERRORS.has(value)
    ? value
    : undefined;
