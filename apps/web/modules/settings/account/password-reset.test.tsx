import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PasswordReset } from "./password-reset";

const { sendPasswordResetLink } = vi.hoisted(() => ({
  sendPasswordResetLink: vi.fn(),
}));
vi.mock("@/app/actions/auth", () => ({ sendPasswordResetLink }));

let root: Root;
let container: HTMLDivElement;
const button = () => container.querySelector("button")!;
const politeRegion = () => container.querySelector('[aria-live="polite"]')!;
const alert = () => container.querySelector('[role="alert"]');
const click = () =>
  act(async () => {
    button().click();
  });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(<PasswordReset />));
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("account password reset", () => {
  it("keeps the polite region mounted and empty until a link is sent", () => {
    expect(button().textContent).toBe("Send reset link");
    expect(politeRegion().textContent).toBe("");
    expect(alert()).toBeNull();
  });

  it("sends one request at a time, then confirms where the link went", async () => {
    let resolve!: (value: unknown) => void;
    sendPasswordResetLink.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    await click();
    expect(button().textContent).toBe("Sending…");
    expect(button().disabled).toBe(true);
    await click();
    expect(sendPasswordResetLink).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolve({
        ok: true,
        data: { message: "We sent a reset link to ada@example.invalid." },
      });
    });
    expect(politeRegion().textContent).toBe(
      "We sent a reset link to ada@example.invalid.",
    );
    expect(alert()).toBeNull();
    expect(button().textContent).toBe("Resend reset link");
    expect(button().disabled).toBe(false);
  });

  it("reports failures as an alert and lets the person retry", async () => {
    sendPasswordResetLink.mockResolvedValue({
      ok: false,
      code: "CONFLICT",
      message:
        "A reset link was sent recently. Check your inbox, or try again in a minute.",
    });
    await click();
    expect(alert()?.textContent).toBe(
      "A reset link was sent recently. Check your inbox, or try again in a minute.",
    );
    expect(politeRegion().textContent).toBe("");
    expect(button().textContent).toBe("Send reset link");

    sendPasswordResetLink.mockRejectedValue(new Error("network"));
    await click();
    expect(alert()?.textContent).toBe(
      "Could not send the reset link. Try again.",
    );
    expect(sendPasswordResetLink).toHaveBeenCalledTimes(2);
  });

  it("explains a failed reset link in view until a new one is sent", async () => {
    const failedLink =
      "This reset link has expired or was already used. Request a new one.";
    // jsdom has no scrollIntoView.
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });
    try {
      // A new key remounts, so the initial state is read again.
      act(() =>
        root.render(<PasswordReset initialError={failedLink} key="failed" />),
      );
      expect(alert()?.textContent).toBe(failedLink);
      expect(scrollIntoView).toHaveBeenCalledWith({ block: "center" });
      expect(button().textContent).toBe("Send reset link");

      sendPasswordResetLink.mockResolvedValue({
        ok: true,
        data: { message: "We sent a reset link to ada@example.invalid." },
      });
      await click();
      expect(alert()).toBeNull();
      expect(politeRegion().textContent).toBe(
        "We sent a reset link to ada@example.invalid.",
      );
    } finally {
      Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
    }
  });
});
