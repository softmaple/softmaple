import { describe, expect, it } from "vitest";
import {
  AUTH_LINK_ERROR,
  authLinkErrorMessage,
  authLinkErrorPath,
  resetLinkError,
} from "./auth-link-errors";

describe("auth link errors", () => {
  it("sends reset failures to the reset page and others to login", () => {
    expect(authLinkErrorPath(AUTH_LINK_ERROR.ResetLinkInvalid)).toBe(
      "/reset-password?error=reset_link_invalid",
    );
    expect(authLinkErrorPath(AUTH_LINK_ERROR.ResetLinkOtherBrowser)).toBe(
      "/reset-password?error=reset_link_other_browser",
    );
    expect(authLinkErrorPath(AUTH_LINK_ERROR.LinkInvalid)).toBe(
      "/login?error=link_invalid",
    );
    expect(authLinkErrorPath(AUTH_LINK_ERROR.SignInFailed)).toBe(
      "/login?error=sign_in_failed",
    );
  });

  it("shows fixed copy for a code and never the URL's own text", () => {
    expect(authLinkErrorMessage(undefined)).toBeUndefined();
    expect(authLinkErrorMessage("reset_link_invalid")).toBe(
      "This reset link has expired or was already used. Request a new one.",
    );
    expect(authLinkErrorMessage("Your account is locked. Call us.")).toBe(
      "Something went wrong. Try again.",
    );
    // Only the codes themselves: inherited keys are not codes.
    expect(authLinkErrorMessage("toString")).toBe(
      "Something went wrong. Try again.",
    );
  });

  it("recognizes only reset-link failures for the account page", () => {
    expect(resetLinkError("reset_link_invalid")).toBe("reset_link_invalid");
    expect(resetLinkError("reset_link_other_browser")).toBe(
      "reset_link_other_browser",
    );
    expect(resetLinkError("sign_in_failed")).toBeUndefined();
    expect(resetLinkError("anything else")).toBeUndefined();
    expect(resetLinkError(undefined)).toBeUndefined();
  });
});
