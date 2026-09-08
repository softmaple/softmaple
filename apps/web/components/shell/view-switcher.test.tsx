// @vitest-environment jsdom

import { useEffect, useRef, type FC } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ViewPanel,
  ViewSwitcher,
  viewPanelId,
  viewTabId,
} from "@/components/shell/view-switcher";

const OPTIONS = [
  { label: "Editor", value: "editor" },
  { label: "Preview", value: "preview" },
  { label: "Markdown", value: "markdown" },
] as const;

/** Counts its own mounts, so a remount is observable rather than inferred. */
const MountCounter: FC<{ readonly onMount: () => void }> = ({ onMount }) => {
  const mounted = useRef(false);
  useEffect(() => {
    if (mounted.current) return;
    mounted.current = true;
    onMount();
  }, [onMount]);
  return <div data-testid="editor">editor</div>;
};

const Harness: FC<{
  readonly onMount: () => void;
  readonly value: string;
}> = ({ onMount, value }) => (
  <div>
    <ViewSwitcher
      baseId="doc"
      label="Document views"
      onValueChange={() => undefined}
      options={OPTIONS}
      value={value}
    />
    {OPTIONS.map((option) => (
      <ViewPanel
        active={option.value === value}
        baseId="doc"
        key={option.value}
        value={option.value}
      >
        {option.value === "editor" ? (
          <MountCounter onMount={onMount} />
        ) : (
          option.label
        )}
      </ViewPanel>
    ))}
  </div>
);

describe("ViewSwitcher", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  const renderAt = (value: string, onMount: () => void): void => {
    act(() => {
      root.render(<Harness onMount={onMount} value={value} />);
    });
  };

  it("keeps every panel mounted, so switching views cannot tear one down", () => {
    let mounts = 0;
    const onMount = () => {
      mounts += 1;
    };

    renderAt("editor", onMount);
    expect(mounts).toBe(1);
    expect(container.querySelector('[data-testid="editor"]')).not.toBeNull();

    renderAt("markdown", onMount);

    // Still in the DOM, still only mounted once.
    expect(container.querySelector('[data-testid="editor"]')).not.toBeNull();
    expect(mounts).toBe(1);
  });

  it("hides inactive panels from the accessibility tree", () => {
    renderAt("editor", () => undefined);
    expect(
      container
        .querySelector(`#${viewPanelId("doc", "editor")}`)
        ?.hasAttribute("hidden"),
    ).toBe(false);
    expect(
      container
        .querySelector(`#${viewPanelId("doc", "preview")}`)
        ?.hasAttribute("hidden"),
    ).toBe(true);
  });

  it("wires tabs to their panels and keeps only the active tab focusable", () => {
    renderAt("preview", () => undefined);
    expect(container.querySelectorAll('[role="tab"]')).toHaveLength(
      OPTIONS.length,
    );
    for (const option of OPTIONS) {
      const tab = container.querySelector(`#${viewTabId("doc", option.value)}`);
      expect(tab?.getAttribute("aria-controls")).toBe(
        viewPanelId("doc", option.value),
      );
      expect(tab?.getAttribute("tabindex")).toBe(
        option.value === "preview" ? "0" : "-1",
      );
    }
  });
});
