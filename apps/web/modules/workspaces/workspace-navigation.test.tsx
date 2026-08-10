// @vitest-environment jsdom

import { act, createElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceNavigation } from "./workspace-navigation";

const usePathname = vi.hoisted(() => vi.fn(() => "/workspace/acme"));
const useSearchParams = vi.hoisted(
  () => vi.fn(() => new URLSearchParams()),
);

vi.mock("next/navigation", () => ({
  usePathname,
  useSearchParams,
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    prefetch,
    ...props
  }: {
    readonly children: ReactNode;
    readonly href: string;
    readonly onClick?: () => void;
    readonly prefetch?: boolean;
  }) =>
    createElement(
      "a",
      {
        href,
        "data-prefetch":
          prefetch === undefined ? "default" : String(prefetch),
        ...props,
      },
      children,
    ),
}));

describe("WorkspaceNavigation", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    usePathname.mockReturnValue("/workspace/acme");
    useSearchParams.mockReturnValue(new URLSearchParams());
  });

  afterEach(() => {
    container.remove();
    vi.clearAllMocks();
  });

  it("disables automatic prefetch for Settings and Members admin links", () => {
    const root = createRoot(container);
    act(() => {
      root.render(
        createElement(WorkspaceNavigation, { workspaceSlug: "acme" }),
      );
    });

    const prefetchByHref = Object.fromEntries(
      Array.from(container.querySelectorAll("a")).map((link) => [
        link.getAttribute("href"),
        link.getAttribute("data-prefetch"),
      ]),
    );

    expect(prefetchByHref["/workspace/acme"]).toBe("default");
    expect(prefetchByHref["/workspace/acme/settings?tab=members"]).toBe(
      "false",
    );
    expect(prefetchByHref["/workspace/acme/settings"]).toBe("false");
    act(() => {
      root.unmount();
    });
  });
});
