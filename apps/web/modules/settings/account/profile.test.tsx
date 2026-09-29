import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { UsersType } from "@/types/model";
import { Profile } from "./profile";

const actions = vi.hoisted(() => ({
  updateProfile: vi.fn(),
  uploadAvatar: vi.fn(),
  removeAvatar: vi.fn(),
}));
vi.mock("@/app/actions/users", () => actions);
vi.mock("./password-reset", () => ({ PasswordReset: () => null }));

const profile: UsersType["Row"] = {
  id: "ada",
  full_name: "Ada Lovelace",
  email: "ada@example.invalid",
  avatar_src: "/workspace/adam.jpg",
  avatar_alt: null,
  first_name: "Ada",
  last_name: "Lovelace",
  created_at: "2026-09-22",
  created_by: null,
  updated_at: null,
  updated_by: null,
};
let root: Root;
let container: HTMLDivElement;
const button = (text: string) =>
  [...container.querySelectorAll("button")].find(
    (node) => node.textContent === text,
  )!;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    })),
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root.render(<Profile initialProfile={profile} />));
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("retains an unsaved name after a network failure and lets the person retry", async () => {
  const input = container.querySelector<HTMLInputElement>("#display-name")!;
  act(() => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, "Ada Byron");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  actions.updateProfile.mockRejectedValueOnce(new Error("network"));
  await act(async () => input.form!.requestSubmit());
  expect(container.querySelector('[role="alert"]')?.textContent).toBe(
    "Could not save your profile. Try again.",
  );
  expect(input.value).toBe("Ada Byron");
  expect(button("Save changes").disabled).toBe(false);

  actions.updateProfile.mockResolvedValue({
    ok: true,
    data: { ...profile, full_name: "Ada Byron" },
  });
  await act(async () => input.form!.requestSubmit());
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(container.querySelector('[role="status"]')?.textContent).toBe(
    "Profile saved.",
  );
  expect(button("Save changes").disabled).toBe(true);
});

it("keeps avatar removal retryable after a network failure", async () => {
  actions.removeAvatar.mockRejectedValue(new Error("network"));
  await act(async () => button("Remove").click());
  expect(container.querySelector('[role="alert"]')?.textContent).toBe(
    "Could not remove your image. Try again.",
  );
  expect(button("Remove").disabled).toBe(false);
});

it("keeps the file picker usable after an upload fails", async () => {
  actions.uploadAvatar.mockRejectedValue(new Error("network"));
  const input =
    container.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, "files", {
    configurable: true,
    value: [new File(["image"], "avatar.png", { type: "image/png" })],
  });
  await act(async () =>
    input.dispatchEvent(new Event("change", { bubbles: true })),
  );
  expect(container.querySelector('[role="alert"]')?.textContent).toBe(
    "Could not upload your image. Try again.",
  );
  expect(input.value).toBe("");
  expect(input.disabled).toBe(false);
});
