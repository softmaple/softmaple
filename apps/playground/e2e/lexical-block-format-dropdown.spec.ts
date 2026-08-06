import { expect, test } from "@playwright/test";

test.describe("Lexical block format dropdown", () => {
  test("dropdown has opaque surface over the editor", async ({ page }) => {
    await page.goto("/demo/lexical-eg-walker");
    await page.locator('[data-testid="lexical-room-ready"]').waitFor();
    await page.locator('[aria-label="Text block format"]').click();

    const content = page.locator('[data-slot="select-content"]');
    await expect(content).toBeVisible();

    const backgroundColor = await content.evaluate(
      (el) => getComputedStyle(el).backgroundColor,
    );
    // Must not be transparent — otherwise editor placeholder shows through.
    expect(backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
    expect(backgroundColor).not.toBe("transparent");

    await expect(
      content.getByRole("option", { name: /Heading 1/i }),
    ).toBeVisible();
    await expect(page.getByText("Enter some rich text...")).toBeVisible();

    // Hit-test the middle of the Heading 1 option — topmost element should
    // belong to the select, not the editor placeholder.
    const option = content.getByRole("option", { name: /Heading 1/i });
    const box = await option.boundingBox();
    expect(box).toBeTruthy();
    if (!box) {
      return;
    }
    const top = await page.evaluate(
      ({ x, y }) => {
        const el = document.elementFromPoint(x, y);
        return {
          slot: el?.closest("[data-slot]")?.getAttribute("data-slot") ?? null,
          text: (el?.textContent ?? "").trim().slice(0, 40),
        };
      },
      { x: box.x + box.width / 2, y: box.y + box.height / 2 },
    );
    expect(top.slot === "select-item" || top.slot === "select-content").toBe(
      true,
    );
    expect(top.text).not.toContain("Enter some rich text");
  });
});
