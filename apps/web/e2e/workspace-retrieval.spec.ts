import { randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";
import { cleanupSeed, createSeed, login } from "./helpers/seed";

test("Field and List retain destinations and search beyond the first page", async ({
  page,
}) => {
  test.skip(
    process.env.E2E_ALLOW_LOCAL_SEED !== "true",
    "Extended fixture is loopback-only",
  );
  const runId = `retrieval-${randomBytes(5).toString("hex")}`;
  const seed = await createSeed(runId, 31);
  try {
    await login(page, seed.owner);
    await page.goto(`/workspace/${seed.workspace.slug}`);
    const home = page.getByRole("region", { name: "Workspace documents" });
    await expect(home.locator("article")).toHaveCount(25);
    await home.getByRole("button", { name: "Load more" }).click();
    await expect(home.locator("article")).toHaveCount(31);
    await home
      .getByRole("button", { name: "Pin Shared notes", exact: true })
      .click();
    await home.getByRole("button", { name: "List view", exact: true }).click();
    await expect(
      home.getByRole("button", { name: "Unpin Shared notes", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await page.reload();
    await expect(home.locator("article")).toHaveCount(25);
    await expect(
      home.getByRole("button", { name: "List view", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await home
      .getByRole("searchbox", { name: "Search document titles" })
      .fill("Shared notes");
    await expect(home.locator("article")).toHaveCount(1);
    await expect(
      home.getByRole("link", { name: /Shared notes/ }),
    ).toHaveAttribute(
      "href",
      `/workspace/${seed.workspace.slug}/doc/${seed.document.slug}`,
    );
    await page.setViewportSize({ width: 320, height: 844 });
    const viewButton = home.getByRole("button", {
      name: "Field view",
      exact: true,
    });
    const bounds = await viewButton.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(320);
    expect(bounds!.height).toBeGreaterThanOrEqual(44);
  } finally {
    await cleanupSeed(runId);
  }
});
