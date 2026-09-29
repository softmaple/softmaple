import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { UpdatePasswordForm } from "./update-password-form";

const { updatePassword } = vi.hoisted(() => ({ updatePassword: vi.fn() }));
vi.mock("@/app/actions/auth", () => ({ updatePassword }));

let root: Root;
let container: HTMLDivElement;
const fill = (input: HTMLInputElement, value: string) => {
  act(() => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root.render(<UpdatePasswordForm />));
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

it("keeps both passwords after a rejected update so a mismatch can be corrected", async () => {
  updatePassword.mockResolvedValue({
    ok: false,
    code: "VALIDATION",
    message: "Check the highlighted fields.",
    fieldErrors: { confirmPassword: ["Passwords do not match."] },
  });
  const password = container.querySelector<HTMLInputElement>("#password")!;
  const confirmation =
    container.querySelector<HTMLInputElement>("#confirmPassword")!;
  fill(password, "newPassword1");
  fill(confirmation, "newPassword2");
  await act(async () => password.form!.requestSubmit());
  expect(password.value).toBe("newPassword1");
  expect(confirmation.value).toBe("newPassword2");
  expect(confirmation.getAttribute("aria-invalid")).toBe("true");
  expect(container.querySelector("#confirmPassword-error")?.textContent).toBe(
    "Passwords do not match.",
  );
  expect(updatePassword).toHaveBeenCalledTimes(1);

  password.focus();
  const toggle = container.querySelector<HTMLButtonElement>(
    'button[aria-label="Show password"]',
  )!;
  const pointerDown = new MouseEvent("pointerdown", {
    bubbles: true,
    cancelable: true,
  });
  act(() => {
    toggle.dispatchEvent(pointerDown);
    toggle.click();
  });
  expect(pointerDown.defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(password);
  expect(password.type).toBe("text");
  expect(confirmation.type).toBe("password");
});
