import { expect, test, type CDPSession, type Page } from "@playwright/test";

test.use({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
});

const beginSwipe = async (client: CDPSession, x: number, y: number) => {
  await client.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x, y }],
  });
};

const moveSwipe = async (
  client: CDPSession,
  page: Page,
  x: number,
  y: number,
  distance: number,
) => {
  // A slow gesture tests the distance threshold independently of a flick.
  for (let step = 1; step <= 6; step++) {
    await client.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x, y: y + (distance * step) / 6 }],
    });
    await page.waitForTimeout(40);
  }
};

const endSwipe = async (client: CDPSession) => {
  await client.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
};

const openNavigation = async (page: Page) => {
  await page.goto("/");
  const trigger = page.getByRole("button", { name: "Open navigation" });
  await trigger.tap();
  const dialog = page.getByRole("dialog", { name: "Explore Softmaple" });
  await expect(dialog).toBeVisible();
  await expect
    .poll(() =>
      dialog.evaluate((element) =>
        Math.abs(element.getBoundingClientRect().bottom - window.innerHeight),
      ),
    )
    .toBeLessThan(1);
  return { trigger, dialog };
};

test("bottom sheet follows touch, snaps back, then dismisses on a longer drag", async ({
  page,
  context,
}) => {
  const { trigger, dialog } = await openNavigation(page);
  const handle = dialog.locator('[data-slot="sheet-handle"]');
  const bounds = await handle.boundingBox();
  if (!bounds) throw new Error("Missing sheet handle");
  const x = bounds.x + bounds.width / 2;
  const y = bounds.y + bounds.height / 2;
  const client = await context.newCDPSession(page);

  await beginSwipe(client, x, y);
  await moveSwipe(client, page, x, y, 28);
  await expect(dialog).toHaveAttribute("data-dragging", "true");
  expect(await dialog.evaluate((element) => element.style.translate)).toBe(
    "0px 28px",
  );
  await endSwipe(client);
  await expect(dialog).toBeVisible();
  await expect(dialog).not.toHaveAttribute("data-dragging");

  await beginSwipe(client, x, y);
  await moveSwipe(client, page, x, y, 160);
  await endSwipe(client);
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await client.detach();
});

test("short-screen content scrolls without dismissing the sheet", async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 390, height: 360 });
  const { dialog } = await openNavigation(page);
  const bounds = await dialog.boundingBox();
  if (!bounds) throw new Error("Missing navigation sheet");
  const client = await context.newCDPSession(page);
  const x = bounds.x + 6;
  const y = bounds.y + bounds.height - 24;
  await beginSwipe(client, x, y);
  await moveSwipe(client, page, x, y, -120);
  await endSwipe(client);
  await expect
    .poll(() => dialog.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(20);

  await beginSwipe(client, x, bounds.y + 85);
  await moveSwipe(client, page, x, bounds.y + 85, 55);
  await endSwipe(client);
  await expect(dialog).toBeVisible();
  await expect(dialog).not.toHaveAttribute("data-dragging");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await client.detach();
});

test("reduced-motion navigation closes and follows the selected destination", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const { dialog } = await openNavigation(page);
  await dialog.getByRole("link", { name: "Log in", exact: true }).tap();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
