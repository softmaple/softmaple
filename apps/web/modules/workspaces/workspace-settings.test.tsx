import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceSettings } from "./workspace-settings";
import { homeFixture } from "./home-fixture";
import { PaperEntrance } from "./workspace-paper";

const actions = vi.hoisted(() => ({
  update: vi.fn(),
  remove: vi.fn(),
  refresh: vi.fn(),
  replace: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: actions.refresh, replace: actions.replace }),
}));
vi.mock("@/app/actions/workspaces", () => ({
  updateWorkspace: actions.update,
  deleteWorkspace: actions.remove,
}));
vi.mock("./workspace-members", () => ({
  WorkspaceMembers: () => <div>Members panel</div>,
}));
const workspace = homeFixture.workspaces[0]!;
let root: Root;
let container: HTMLDivElement;
const button = (text: string) =>
  [...container.querySelectorAll("button")].find(
    (node) => node.textContent === text,
  )!;
const name = () =>
  container.querySelector<HTMLInputElement>("#workspace-name")!;
const editName = (value: string) =>
  act(() => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(name(), value);
    name().dispatchEvent(new Event("input", { bubbles: true }));
  });
const submit = () =>
  act(() => {
    container
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });

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
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
const render = (role: "OWNER" | "VIEWER" = "OWNER", preview = false) =>
  act(() => {
    root.render(
      <WorkspaceSettings
        preview={preview}
        initialTab="general"
        workspace={workspace}
        members={homeFixture.members}
        role={role}
      />,
    );
  });

describe("Workspace settings editing", () => {
  it("keeps server-rendered paper content visible before hydration", () => {
    const markup = renderToStaticMarkup(
      <PaperEntrance>
        <h1>Workspace content</h1>
      </PaperEntrance>,
    );
    const serverContent = document.createElement("div");
    serverContent.innerHTML = markup;
    const heading = serverContent.querySelector("h1");
    expect(heading?.textContent).toBe("Workspace content");
    for (let node = heading?.parentElement; node; node = node.parentElement) {
      expect(node.style.opacity).not.toBe("0");
      expect(node.hidden).toBe(false);
    }
  });
  it("disables pristine/invalid saves and Cancel restores the saved value", () => {
    render();
    expect(button("Save changes").disabled).toBe(true);
    editName("Revised studio");
    expect(button("Save changes").disabled).toBe(false);
    act(() => button("Cancel").click());
    expect(name().value).toBe(workspace.title);
    editName("   ");
    expect(button("Save changes").disabled).toBe(true);
    expect(name().getAttribute("aria-invalid")).toBe("true");
    expect(
      container.querySelector<HTMLInputElement>("#workspace-url")!.readOnly,
    ).toBe(true);
  });
  it("blocks duplicate submissions, then adopts the confirmed saved result", async () => {
    let resolve!: (value: unknown) => void;
    actions.update.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    render();
    editName("New name");
    submit();
    submit();
    expect(actions.update).toHaveBeenCalledTimes(1);
    expect(button("Saving…").disabled).toBe(true);
    await act(async () => {
      resolve({ ok: true, data: { ...workspace, title: "New name" } });
    });
    expect(container.querySelector('[role="status"]')?.textContent).toBe(
      "Changes saved.",
    );
    expect(button("Save changes").disabled).toBe(true);
    editName("Unsaved again");
    act(() => button("Cancel").click());
    expect(name().value).toBe("New name");
  });
  it("retains edits and reports a server failure without success feedback", async () => {
    actions.update.mockResolvedValue({ ok: false, message: "Access denied." });
    render();
    editName("Keep this draft");
    await act(async () => {
      container
        .querySelector("form")!
        .dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
    });
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "Access denied.",
    );
    expect(name().value).toBe("Keep this draft");
    expect(actions.refresh).not.toHaveBeenCalled();
    act(() => button("Delete workspace").click());
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.querySelector('[role="alert"]')).toBeNull();
    expect(name().value).toBe("Keep this draft");
  });
  it("guards category navigation and reload while edits are unsaved", () => {
    render();
    editName("Unsaved");
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const link = container.querySelector<HTMLAnchorElement>(
      'a[href$="?tab=members"]',
    )!;
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    act(() => {
      link.dispatchEvent(click);
    });
    expect(confirm).toHaveBeenCalledOnce();
    expect(click.defaultPrevented).toBe(true);
    const unload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);
    expect(name().value).toBe("Unsaved");
  });
  it("never dispatches fixture edits to real server actions", () => {
    render("OWNER", true);
    editName("Preview change");
    submit();
    expect(actions.update).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "Design preview only. Changes are not saved.",
    );
  });
  it("keeps viewer fields read-only and prevents destructive mutations", () => {
    render("VIEWER");
    expect(name().disabled).toBe(true);
    expect(button("Save changes").disabled).toBe(true);
    expect(button("Delete workspace").disabled).toBe(true);
    submit();
    expect(actions.update).not.toHaveBeenCalled();
    expect(actions.remove).not.toHaveBeenCalled();
  });
});
