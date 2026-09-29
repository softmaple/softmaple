import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ResetPasswordForm } from "./reset-password-form";

const { resetPassword } = vi.hoisted(() => ({ resetPassword: vi.fn() }));
vi.mock("@/app/actions/auth", () => ({ resetPassword }));

// A Server Function returns a new result object on every call.
const replies = (result: object) =>
  resetPassword.mockImplementation(async () => structuredClone(result));

const RATE_LIMITED =
  "A reset link was sent recently. Check your inbox, or try again in a minute.";

let root: Root;
let container: HTMLDivElement;
const status = () => container.querySelector('[role="status"]');
const alert = () => container.querySelector('[role="alert"]');
const emailInput = () =>
  container.querySelector<HTMLInputElement>('input[type="email"]');
const buttonNamed = (name: string) =>
  [...container.querySelectorAll("button")].find(
    (button) => button.textContent === name,
  );
const typeEmail = (email: string) =>
  act(() => {
    const input = emailInput()!;
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, email);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
const submitWith = async (email: string) => {
  typeEmail(email);
  await act(async () => emailInput()!.form!.requestSubmit());
};
const click = (name: string) =>
  act(async () => {
    buttonNamed(name)!.click();
  });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("forgot password form", () => {
  it("stays on the page and confirms where the link went", async () => {
    act(() => root.render(<ResetPasswordForm />));
    replies({
      ok: true,
      data: { email: "ada@example.invalid" },
    });
    await submitWith("Ada@Example.invalid");

    expect(resetPassword).toHaveBeenCalledTimes(1);
    expect(status()?.textContent).toBe(
      "If an account uses ada@example.invalid, a password reset link is on its way.",
    );
    expect(emailInput()).toBeNull();
    expect(buttonNamed("Resend reset link")).toBeDefined();
  });

  it("resends to the same address, keeping the confirmation on failure", async () => {
    act(() => root.render(<ResetPasswordForm />));
    replies({
      ok: true,
      data: { email: "ada@example.invalid" },
    });
    await submitWith("ada@example.invalid");

    await click("Resend reset link");
    const resent = resetPassword.mock.calls[1]?.[1] as FormData;
    expect(resent.get("email")).toBe("ada@example.invalid");
    expect(status()?.textContent).toBe(
      "If an account uses ada@example.invalid, another password reset link is on its way.",
    );

    replies({
      ok: false,
      code: "CONFLICT",
      message: RATE_LIMITED,
    });
    await click("Resend reset link");
    expect(alert()?.textContent).toBe(RATE_LIMITED);
    expect(status()?.textContent).toContain("ada@example.invalid");
  });

  it("goes back to the form, prefilled, for a different email", async () => {
    act(() =>
      root.render(
        <ResetPasswordForm initialError="This reset link has expired or was already used. Request a new one." />,
      ),
    );
    expect(alert()).not.toBeNull();
    replies({
      ok: true,
      data: { email: "ada@example.invalid" },
    });
    await submitWith("ada@example.invalid");
    // The failed link is dealt with once a new one is on its way.
    expect(alert()).toBeNull();

    await click("Use a different email");
    expect(emailInput()?.value).toBe("ada@example.invalid");
    expect(alert()).toBeNull();
    expect(status()).toBeNull();
  });

  it("keeps the form when the email is invalid", async () => {
    act(() => root.render(<ResetPasswordForm />));
    replies({
      ok: false,
      code: "VALIDATION",
      message: "Check the highlighted fields.",
      fieldErrors: { email: ["Enter a valid email address."] },
    });
    // Passes the browser's check; the server is stricter.
    await submitWith("ada@example");

    expect(emailInput()?.getAttribute("aria-invalid")).toBe("true");
    expect(container.querySelector("#email-error")?.textContent).toBe(
      "Enter a valid email address.",
    );
    expect(status()).toBeNull();
    expect(emailInput()?.value).toBe("ada@example");

    // Editing the field clears the stale error until the next submit.
    typeEmail("ada@example.invalid");
    expect(emailInput()?.hasAttribute("aria-invalid")).toBe(false);
    expect(container.querySelector("#email-error")).toBeNull();

    await submitWith("ada@example");
    expect(emailInput()?.getAttribute("aria-invalid")).toBe("true");
  });
});
