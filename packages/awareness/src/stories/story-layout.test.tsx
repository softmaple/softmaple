import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { StoryShowcase } from "./story-layout";

const reactActGlobal = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};

reactActGlobal.IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLElement | undefined;
let root: Root | undefined;

const render = (ui: React.ReactNode): HTMLElement => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root?.render(ui);
  });
  return host;
};

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  host?.remove();
  host = undefined;
  root = undefined;
});

describe("StoryShowcase header conditional", () => {
  it("omits the header when no eyebrow, title, or subtitle is provided", () => {
    const container = render(
      <StoryShowcase>
        <span data-testid="child">child</span>
      </StoryShowcase>,
    );

    expect(container.querySelector("header")).toBeNull();
    expect(container.querySelector('[data-testid="child"]')).not.toBeNull();
  });

  it("renders only the eyebrow chip with an aria-hidden dot", () => {
    const container = render(
      <StoryShowcase eyebrow="Pokédex · Avatar">
        <span />
      </StoryShowcase>,
    );

    const header = container.querySelector("header");
    expect(header).not.toBeNull();
    expect(header?.textContent).toContain("Pokédex · Avatar");
    expect(header?.querySelector("h2")).toBeNull();
    expect(header?.querySelector("p")).toBeNull();

    const dot = header?.querySelector('[aria-hidden="true"]');
    expect(dot).not.toBeNull();
  });

  it("renders only the title as an h2", () => {
    const container = render(
      <StoryShowcase title="Trainer avatar">
        <span />
      </StoryShowcase>,
    );

    const header = container.querySelector("header");
    expect(header).not.toBeNull();
    expect(header?.querySelector("h2")?.textContent).toBe("Trainer avatar");
    expect(header?.textContent).not.toContain("Pokédex");
    expect(header?.querySelector("p")).toBeNull();
  });

  it("renders only the subtitle paragraph", () => {
    const container = render(
      <StoryShowcase subtitle="A single trainer's avatar.">
        <span />
      </StoryShowcase>,
    );

    const header = container.querySelector("header");
    expect(header).not.toBeNull();
    expect(header?.querySelector("p")?.textContent).toBe(
      "A single trainer's avatar.",
    );
    expect(header?.querySelector("h2")).toBeNull();
  });

  it("renders eyebrow, title, and subtitle together", () => {
    const container = render(
      <StoryShowcase
        eyebrow="Pokédex · Roster"
        subtitle="Stacked avatars with overflow."
        title="Trainer roster"
      >
        <span />
      </StoryShowcase>,
    );

    const header = container.querySelector("header");
    expect(header).not.toBeNull();
    expect(header?.textContent).toContain("Pokédex · Roster");
    expect(header?.querySelector("h2")?.textContent).toBe("Trainer roster");
    expect(header?.querySelector("p")?.textContent).toBe(
      "Stacked avatars with overflow.",
    );
    expect(
      header
        ?.querySelector('span > span[aria-hidden="true"]')
        ?.getAttribute("aria-hidden"),
    ).toBe("true");
  });
});
