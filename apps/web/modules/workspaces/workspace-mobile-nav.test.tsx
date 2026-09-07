// @vitest-environment jsdom

import { act, createElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DocsType } from "@/types/model";
import { WorkspaceMobileNav } from "./workspace-mobile-nav";

const usePathname = vi.hoisted(() => vi.fn(() => "/workspace/acme"));

vi.mock("next/navigation", () => ({
  usePathname,
  useSearchParams: () => new URLSearchParams(),
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
        "data-prefetch": prefetch === undefined ? "default" : String(prefetch),
        ...props,
      },
      children,
    ),
}));

const documents: ReadonlyArray<DocsType["Row"]> = [
  {
    author_id: "author-1",
    created_at: "2026-01-01T00:00:00.000Z",
    created_by: null,
    id: "doc-1",
    is_public: false,
    slug: "field-notes",
    title: "Field notes",
    updated_at: "2026-01-02T00:00:00.000Z",
    updated_by: null,
    workspace_id: 1,
  },
];

const renderNav = (container: HTMLDivElement) => {
  const root = createRoot(container);
  act(() => {
    root.render(
      createElement(WorkspaceMobileNav, {
        canEdit: true,
        documents,
        workspaceSlug: "acme",
      }),
    );
  });
  return root;
};

const menuButton = (container: HTMLDivElement): HTMLButtonElement => {
  const button = container.querySelector<HTMLButtonElement>(
    'button[aria-label="Open workspace navigation"]',
  );
  if (button === null) throw new Error("menu button is not rendered");
  return button;
};

const sheet = (): HTMLElement | null =>
  document.body.querySelector<HTMLElement>('[data-slot="sheet-content"]');

describe("WorkspaceMobileNav", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    container = document.createElement("div");
    document.body.appendChild(container);
    usePathname.mockReturnValue("/workspace/acme");
  });

  afterEach(() => {
    container.remove();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("puts the menu button in a bar that closes the shell rather than a header", () => {
    const root = renderNav(container);

    const bar = menuButton(container).closest("nav");
    expect(bar?.getAttribute("aria-label")).toBe("Workspace");
    expect(bar?.className).toContain("border-t");
    expect(bar?.className).toContain("md:hidden");
    expect(container.querySelector("header")).toBeNull();

    act(() => {
      root.unmount();
    });
  });

  it("opens the navigation as a bottom sheet with a grabber", () => {
    const root = renderNav(container);
    expect(sheet()).toBeNull();

    act(() => {
      menuButton(container).click();
    });

    expect(sheet()?.getAttribute("data-side")).toBe("bottom");
    expect(
      document.body.querySelector('[data-slot="sheet-handle"]'),
    ).not.toBeNull();

    act(() => {
      root.unmount();
    });
  });

  it("closes the sheet once a destination inside it is chosen", () => {
    const root = renderNav(container);
    act(() => {
      menuButton(container).click();
    });

    const documentLink = document.body.querySelector<HTMLAnchorElement>(
      'a[href="/workspace/acme/doc/field-notes"]',
    );
    expect(documentLink).not.toBeNull();
    act(() => {
      documentLink?.click();
    });

    expect(sheet()).toBeNull();

    act(() => {
      root.unmount();
    });
  });
});
