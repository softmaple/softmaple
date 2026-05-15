import { type BrowserContext, expect, test } from "@playwright/test";

/**
 * Regression: Tab B appending text at the end of "Hello" (typed by Tab A)
 * used to merge as " worldHello" because React's `<textarea>` re-applies
 * `defaultValue` on every commit, writing `el.value = text` and resetting
 * the caret to 0. The next keystroke then inserted at offset 0 in the
 * DOM, and the diff-based CRDT bridge faithfully replicated that to A.
 *
 * Fixed by removing `defaultValue` and owning the DOM value imperatively
 * in `EditorSurface`'s `useLayoutEffect`, which preserves the caret.
 */
test.describe("Awareness collab demo - CRDT merge", () => {
  let context: BrowserContext;

  test.beforeEach(async ({ browser }) => {
    context = await browser.newContext();
  });

  test.afterEach(async () => {
    await context.close();
  });

  const seedTwoTabs = async () => {
    const pageA = await context.newPage();
    await pageA.goto("/demo/awareness-collab");
    await pageA.waitForLoadState("networkidle");
    await pageA.locator("button", { hasText: "Pikachu" }).click();
    const textA = pageA.locator("textarea").first();
    await expect(textA).toBeVisible();

    const pageB = await context.newPage();
    await pageB.goto("/demo/awareness-collab");
    await pageB.waitForLoadState("networkidle");
    await pageB.locator("button", { hasText: "Charmander" }).click();
    const textB = pageB.locator("textarea").first();
    await expect(textB).toBeVisible();

    return { pageA, textA, pageB, textB };
  };

  test("tab B appending to tab A's text merges in order (explicit caret)", async () => {
    const { pageA, textA, textB } = await seedTwoTabs();

    await textA.click();
    await pageA.keyboard.type("Hello", { delay: 20 });
    await expect(textB).toHaveValue("Hello");
    await pageA.waitForTimeout(100);

    // Explicitly position the caret at end-of-text. Catches regressions
    // where the React commit overwrites `el.value` and resets the caret
    // between renders.
    await textB.focus();
    await textB.evaluate((el: HTMLTextAreaElement) => {
      el.setSelectionRange(el.value.length, el.value.length);
    });

    await textB.pressSequentially(" world", { delay: 20 });

    await expect(textA).toHaveValue("Hello world");
    await expect(textB).toHaveValue("Hello world");
  });

  test("tab B appending via click + End merges in order (user-flow caret)", async () => {
    const { pageA, textA, pageB, textB } = await seedTwoTabs();

    await textA.click();
    await pageA.keyboard.type("Hello", { delay: 20 });
    await expect(textB).toHaveValue("Hello");
    await pageA.waitForTimeout(100);

    // User-level path: click into the textarea, press End to move to
    // end-of-text, then type. Exercises the same bug at the layer the
    // user actually hits — if React ever re-introduces a `value` /
    // `defaultValue` overwrite, the caret will reset between End and
    // the next keystroke and this test will fail.
    await textB.click();
    await pageB.keyboard.press("End");
    await pageB.keyboard.type(" world", { delay: 20 });

    await expect(textA).toHaveValue("Hello world");
    await expect(textB).toHaveValue("Hello world");
  });
});
