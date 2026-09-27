import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HomeActivity } from "./home-activity";
import { homeFixture } from "./home-fixture";
import { HomeMotion } from "./home-motion";
import { MobileWorkspaceHome } from "./mobile-workspace-home";
import type { ActiveWriter, WritingActivitySnapshot } from "./writing-activity";

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    prefetch,
    ...props
  }: {
    readonly children: ReactNode;
    readonly href: string;
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
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn(), push: vi.fn() }),
}));

const writer = (
  fullName: string,
  lastWrittenAt: string,
  isViewer = false,
): ActiveWriter => ({
  avatarSrc: null,
  fullName,
  isViewer,
  lastWrittenAt,
  userId: `user-${fullName.toLowerCase()}`,
});

const activity = (
  ...writers: ReadonlyArray<ActiveWriter>
): WritingActivitySnapshot => ({
  documents: [
    {
      id: "doc-1",
      lastWrittenAt: writers[0]?.lastWrittenAt ?? "2026-09-27T10:00:00.000Z",
      slug: "a-brighter-tomorrow",
      title: "A brighter tomorrow",
      writers,
    },
  ],
  observedAt: "2026-09-27T10:02:30.000Z",
});

let container: HTMLDivElement;
let root: Root;
const onBrowse = vi.fn();

const renderDesktop = (
  snapshot: WritingActivitySnapshot | null,
  visualFixture = false,
) =>
  act(() =>
    root.render(
      <HomeMotion>
        <HomeActivity
          activity={snapshot}
          onBrowse={onBrowse}
          visualFixture={visualFixture}
          workspaceSlug="acme"
        />
      </HomeMotion>,
    ),
  );

const region = () =>
  container.querySelector<HTMLElement>('section[aria-label="Happening now"]');
const links = () => [...container.querySelectorAll<HTMLAnchorElement>("a")];

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
});

describe("HomeActivity", () => {
  it("features the document others are writing in", () => {
    renderDesktop(
      activity(
        writer("Mia", "2026-09-27T10:00:30.000Z"),
        writer("Adam", "2026-09-27T10:00:10.000Z", true),
        writer("Leo", "2026-09-27T09:59:00.000Z"),
      ),
    );
    const text = region()?.textContent ?? "";
    expect(text).toContain("3 people writing");
    expect(text).toContain("A brighter tomorrow");
    expect(text).toContain("The latest words landed 2 minutes ago.");
    expect(text).toContain("You, Mia and Leo are shaping this document.");

    const tags = container.querySelector('ul[aria-label="People writing"]');
    expect(
      [...(tags?.querySelectorAll("li") ?? [])].map((tag) => tag.textContent),
    ).toEqual(["Mia", "You", "Leo"]);

    const title = container.querySelector("h3");
    const join = links().find((link) => link.textContent?.includes("Join"));
    expect(join?.getAttribute("href")).toBe(
      "/workspace/acme/doc/a-brighter-tomorrow",
    );
    expect(join?.getAttribute("aria-describedby")).toBe(title?.id);
    expect(links().map((link) => link.textContent?.trim())).toContain(
      "Join document",
    );
  });

  it("invites the viewer back to their own recent writing", () => {
    renderDesktop(activity(writer("Adam", "2026-09-27T10:02:00.000Z", true)));
    const text = region()?.textContent ?? "";
    expect(text).toContain("1 person writing");
    expect(text).toContain("Your latest words landed just now.");
    expect(text).toContain("You were just writing here.");
    expect(links().map((link) => link.textContent?.trim())).toContain(
      "Keep writing",
    );
  });

  it("collapses writers beyond the visible tags into a count", () => {
    renderDesktop(
      activity(
        writer("Mia", "2026-09-27T10:02:00.000Z"),
        writer("Leo", "2026-09-27T10:01:00.000Z"),
        writer("Sarah", "2026-09-27T10:00:00.000Z"),
        writer("Ines", "2026-09-27T09:59:00.000Z"),
        writer("Omar", "2026-09-27T09:58:00.000Z"),
      ),
    );
    const tags = container.querySelector('ul[aria-label="People writing"]');
    expect(tags?.textContent).toBe("MiaLeoSarah+2 more");
    expect(region()?.textContent).toContain(
      "Mia, Leo and 3 others are shaping this document.",
    );
  });

  it("stays quiet but useful when nobody is writing", () => {
    renderDesktop({ documents: [], observedAt: "2026-09-27T10:00:00.000Z" });
    expect(region()?.textContent).toContain("No one is writing right now");
    expect(links()).toHaveLength(0);
    const open = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Open a document",
    );
    act(() => open?.click());
    expect(onBrowse).toHaveBeenCalledTimes(1);
  });

  it("says when activity could not be read", () => {
    renderDesktop(null);
    expect(region()?.textContent).toContain("Live activity is unavailable");
    expect(region()?.textContent).not.toContain("writing right now");
  });

  it("keeps the preview excerpt for the visual fixture only", () => {
    renderDesktop(homeFixture.activity, true);
    expect(region()?.textContent).toContain("minds to write together");
    expect(region()?.textContent).not.toContain("latest words");
  });
});

describe("MobileWorkspaceHome happening now", () => {
  const renderMobile = (snapshot: WritingActivitySnapshot | null) =>
    act(() =>
      root.render(
        <HomeMotion>
          <MobileWorkspaceHome
            {...homeFixture}
            activity={snapshot}
            visualFixture={false}
          />
        </HomeMotion>,
      ),
    );
  const section = () =>
    container.querySelector<HTMLElement>(
      'section[aria-labelledby="mobile-activity"]',
    );

  it("summarizes who is writing and links to the document", () => {
    renderMobile(
      activity(
        writer("Mia", "2026-09-27T10:02:00.000Z"),
        writer("Leo", "2026-09-27T10:01:00.000Z"),
      ),
    );
    expect(section()?.textContent).toContain("2 people writing");
    expect(section()?.textContent).toContain(
      "Mia and Leo are shaping this document. The latest words landed just now.",
    );
    const join = section()?.querySelector("a");
    expect(join?.textContent).toBe("Join");
    expect(join?.getAttribute("href")).toBe(
      "/workspace/design-review/doc/a-brighter-tomorrow",
    );
  });

  it("offers browsing when the workspace is quiet or unavailable", () => {
    renderMobile({ documents: [], observedAt: "2026-09-27T10:00:00.000Z" });
    expect(section()?.textContent).toContain("No one is writing right now.");
    expect(section()?.querySelector("a")).toBeNull();

    renderMobile(null);
    expect(section()?.textContent).toContain(
      "Live activity is unavailable right now.",
    );
  });
});
