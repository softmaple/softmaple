import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { WorkspaceRouteFrame } from "./workspace-route-frame";

const pathname = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ usePathname: pathname }));

describe("Workspace homepage chrome isolation", () => {
  it("keeps editor and settings chrome when navigating away from home", () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    const render = (path: string, child: ReactNode) => {
      pathname.mockReturnValue(path);
      act(() =>
        root.render(
          <WorkspaceRouteFrame
            workspaceSlug="studio"
            legacy={<div data-testid="existing-layout">{child}</div>}
          >
            {child}
          </WorkspaceRouteFrame>,
        ),
      );
    };
    render("/workspace/studio", <main>Home</main>);
    expect(
      container.querySelector('[data-testid="existing-layout"]'),
    ).toBeNull();
    expect(container.querySelectorAll("main")).toHaveLength(1);
    for (const path of [
      "/workspace/studio/doc/new",
      "/workspace/studio/doc/notes",
      "/workspace/studio/settings",
    ]) {
      render(path, <main>Existing page</main>);
      expect(
        container.querySelector('[data-testid="existing-layout"]'),
      ).not.toBeNull();
      expect(container.querySelectorAll("main")).toHaveLength(1);
    }
    render("/workspace/studio", <main>Home again</main>);
    expect(
      container.querySelector('[data-testid="existing-layout"]'),
    ).toBeNull();
    act(() => root.unmount());
  });
});
