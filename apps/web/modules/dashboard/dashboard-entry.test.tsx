import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DashboardEntry } from "./dashboard-entry";
import { RememberWorkspace } from "@/modules/workspaces/remember-workspace";
import { useDefaultWorkspace } from "@/modules/workspaces/use-default-workspace";
import { homeFixture } from "@/modules/workspaces/home-fixture";

const router = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("./dashboard", () => ({
  Dashboard: ({ workspaces }: { workspaces: unknown[] }) => (
    <main>
      {workspaces.length ? "All workspaces" : "Create your first workspace"}
    </main>
  ),
}));

const first = homeFixture.workspaces[0]!;
const second = { ...first, id: first.id + 1, slug: "other-space" };
const workspaces = [first, second];
const key = (userId = "user-a") => `softmaple:default-workspace:v1:${userId}`;
let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  window.localStorage.clear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const renderEntry = (
  props: Partial<Parameters<typeof DashboardEntry>[0]> = {},
) =>
  act(() => {
    root.render(
      <DashboardEntry userId="user-a" workspaces={workspaces} {...props} />,
    );
  });

function Preference({ userId }: { userId: string }) {
  const { workspaceId } = useDefaultWorkspace(userId);
  return <output>{workspaceId}</output>;
}

describe("Dashboard default workspace", () => {
  it("renders a loading state on the server without accessing localStorage", () => {
    const read = vi.spyOn(Storage.prototype, "getItem");
    const html = renderToString(
      <DashboardEntry userId="user-a" workspaces={workspaces} />,
    );
    expect(html).toContain("Opening your workspace");
    expect(html).not.toContain("All workspaces");
    expect(read).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("persists and opens the first accessible workspace on the first visit", () => {
    renderEntry();
    expect(router.replace).toHaveBeenCalledWith(`/workspace/${first.slug}`);
    expect(window.localStorage.getItem(key())).toBe(String(first.id));
    expect(container.textContent).not.toContain("All workspaces");
  });

  it("opens the saved workspace even when it is not first in the list", () => {
    window.localStorage.setItem(key(), String(second.id));
    renderEntry();
    expect(router.replace).toHaveBeenCalledExactlyOnceWith(
      `/workspace/${second.slug}`,
    );
  });

  it.each([
    "deleted-workspace",
    "not-valid-json",
    "javascript:alert(1)",
  ])("replaces a stale or invalid preference (%s) with an accessible workspace", (stored) => {
    window.localStorage.setItem(key(), stored);
    renderEntry();
    expect(router.replace).toHaveBeenCalledWith(`/workspace/${first.slug}`);
    expect(window.localStorage.getItem(key())).toBe(String(first.id));
  });

  it("isolates preferences when the signed-in account changes", () => {
    window.localStorage.setItem(key(), String(second.id));
    renderEntry({ userId: "user-b" });
    expect(router.replace).toHaveBeenLastCalledWith(`/workspace/${first.slug}`);
    expect(window.localStorage.getItem(key())).toBe(String(second.id));
    expect(window.localStorage.getItem(key("user-b"))).toBe(String(first.id));
    renderEntry();
    expect(router.replace).toHaveBeenLastCalledWith(
      `/workspace/${second.slug}`,
    );
  });

  it("preserves the explicit workspace list without redirecting or changing the default", () => {
    window.localStorage.setItem(key(), String(second.id));
    renderEntry({ showAll: true });
    expect(container.textContent).toBe("All workspaces");
    expect(router.replace).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(key())).toBe(String(second.id));
  });

  it("clears stale preferences and shows creation when no workspaces remain", () => {
    window.localStorage.setItem(key(), String(second.id));
    renderEntry({ workspaces: [] });
    expect(container.textContent).toBe("Create your first workspace");
    expect(window.localStorage.getItem(key())).toBeNull();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("still opens a workspace when browser storage access is blocked", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("Storage blocked", "SecurityError");
    });
    renderEntry();
    expect(router.replace).toHaveBeenCalledWith(`/workspace/${first.slug}`);
  });

  it("still opens a workspace when storage writes fail", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Storage full", "QuotaExceededError");
    });
    renderEntry();
    expect(router.replace).toHaveBeenCalledWith(`/workspace/${first.slug}`);
  });

  it("remembers workspace navigation and notifies subscribers in the same tab", () => {
    const visit = (workspaceId: number) =>
      act(() => {
        root.render(
          <>
            <Preference userId="user-a" />
            <RememberWorkspace userId="user-a" workspaceId={workspaceId} />
          </>,
        );
      });
    visit(first.id);
    expect(container.textContent).toBe(String(first.id));
    visit(second.id);
    expect(container.textContent).toBe(String(second.id));
    expect(window.localStorage.getItem(key())).toBe(String(second.id));
    renderEntry();
    expect(router.replace).toHaveBeenCalledWith(`/workspace/${second.slug}`);
  });

  it("updates subscribers when another tab changes or clears preferences", () => {
    act(() => root.render(<Preference userId="user-a" />));
    act(() => {
      window.localStorage.setItem(key(), String(second.id));
      window.dispatchEvent(new StorageEvent("storage", { key: key() }));
    });
    expect(container.textContent).toBe(String(second.id));
    act(() => {
      window.localStorage.clear();
      window.dispatchEvent(new StorageEvent("storage", { key: null }));
    });
    expect(container.textContent).toBe("");
  });
});
