import { expect, test } from "@playwright/test";
import {
  appendText,
  expectDocument,
  expectDurableAfter,
  openRoom,
  openSecondTab,
  roomFor,
  storageBytes,
} from "./helpers/lexical-eg-walker";

test.describe("Lexical EG-walker cross-tab collaboration", () => {
  test("synchronizes text bidirectionally between two tabs", async ({
    context,
    page,
  }, testInfo) => {
    const roomId = roomFor(testInfo);
    const first = await openRoom(page, roomId);
    await expect(first.demo).toHaveAttribute(
      "data-persistence-leader",
      "leader",
    );
    const second = await openSecondTab(context, roomId);
    await expect(second.demo).toHaveAttribute(
      "data-persistence-leader",
      "waiting",
    );

    await appendText(first, "Hello from tab A");
    await expectDocument(second, "Hello from tab A");

    await appendText(second, " + tab B");
    await expectDocument(first, "Hello from tab A + tab B");
    await expectDocument(second, "Hello from tab A + tab B");
  });

  test("converges concurrent inserts at the same empty position", async ({
    context,
    page,
  }, testInfo) => {
    const roomId = roomFor(testInfo);
    const first = await openRoom(page, roomId);
    const second = await openSecondTab(context, roomId);

    await Promise.all([first.editor.click(), second.editor.click()]);
    await Promise.all([
      first.editor.pressSequentially("AAA", { delay: 15 }),
      second.editor.pressSequentially("BBB", { delay: 15 }),
    ]);

    await expect(first.editor).toContainText("AAA");
    await expect(first.editor).toContainText("BBB");
    await expect(second.editor).toContainText("AAA");
    await expect(second.editor).toContainText("BBB");
    expect(await first.editor.innerText()).toBe(
      await second.editor.innerText(),
    );
  });

  test("renders a backwards cross-block remote selection", async ({
    context,
    page,
  }, testInfo) => {
    const roomId = roomFor(testInfo);
    const first = await openRoom(page, roomId);
    const second = await openSecondTab(context, roomId);

    await first.editor.click();
    await first.editor.pressSequentially("first", { delay: 15 });
    await first.editor.press("Enter");
    await first.editor.pressSequentially("second", { delay: 15 });
    await expect(second.editor).toContainText("first");
    await expect(second.editor).toContainText("second");

    await first.editor.evaluate((editable) => {
      const blocks = editable.querySelectorAll("p");
      const firstText = blocks[0]?.querySelector(
        "[data-lexical-text]",
      )?.firstChild;
      const secondText = blocks[1]?.querySelector(
        "[data-lexical-text]",
      )?.firstChild;
      if (!(firstText instanceof Text) || !(secondText instanceof Text)) {
        throw new Error("Expected two rendered text blocks");
      }
      const selection = window.getSelection();
      if (selection === null) throw new Error("Selection API is unavailable");
      selection.setBaseAndExtent(
        secondText,
        secondText.data.length,
        firstText,
        0,
      );
      document.dispatchEvent(new Event("selectionchange", { bubbles: true }));
    });

    const remoteSelection = second.page.locator(
      '[data-testid^="remote-selection-"]',
    );
    await expect.poll(() => remoteSelection.count()).toBeGreaterThan(0);
    await expect(
      second.page.locator('[data-testid^="remote-caret-"]'),
    ).toContainText("↖");
  });

  test("synchronizes inline formatting and block conversion", async ({
    context,
    page,
  }, testInfo) => {
    const roomId = roomFor(testInfo);
    const first = await openRoom(page, roomId);
    const second = await openSecondTab(context, roomId);

    await appendText(first, "Styled title");
    await expectDocument(second, "Styled title");
    await first.editor.press("ControlOrMeta+A");
    await first.page.getByRole("button", { name: "Bold" }).click();
    await expect(second.editor.locator("strong")).toHaveText("Styled title");

    await first.page
      .getByRole("combobox", { name: "Text block format" })
      .click();
    await first.page.getByRole("option", { name: "Heading 2" }).click();
    await expect(second.editor.locator("h2")).toHaveText("Styled title");
    await expect(second.editor.locator("h2 strong")).toHaveText("Styled title");
  });

  test("hydrates a late joiner and continues synchronizing", async ({
    context,
    page,
  }, testInfo) => {
    const roomId = roomFor(testInfo);
    const first = await openRoom(page, roomId);
    const second = await openSecondTab(context, roomId);
    const initialBytes = await storageBytes(first);

    await appendText(first, "Written before the late join");
    await expectDocument(second, "Written before the late join");
    await expectDurableAfter(first, initialBytes);

    const late = await openSecondTab(context, roomId);
    await expectDocument(late, "Written before the late join");
    await appendText(late, " and after it");
    await expectDocument(first, "Written before the late join and after it");
    await expectDocument(second, "Written before the late join and after it");
  });

  test("restores a durable document after every tab is closed", async ({
    context,
    page,
  }, testInfo) => {
    const roomId = roomFor(testInfo);
    const first = await openRoom(page, roomId);
    const initialBytes = await storageBytes(first);

    await appendText(first, "Persist me after all tabs close");
    await expectDurableAfter(first, initialBytes);
    await first.page.close();

    expect(context.pages()).toHaveLength(0);
    const restored = await openSecondTab(context, roomId);
    await expectDocument(restored, "Persist me after all tabs close");
    await expect(restored.demo).toHaveAttribute(
      "data-persistence-durability",
      "saved",
    );
  });

  test("promotes a follower after leader close and survives reload", async ({
    context,
    page,
  }, testInfo) => {
    const roomId = roomFor(testInfo);
    const leader = await openRoom(page, roomId);
    await expect(leader.demo).toHaveAttribute(
      "data-persistence-leader",
      "leader",
    );
    const follower = await openSecondTab(context, roomId);
    await expect(follower.demo).toHaveAttribute(
      "data-persistence-leader",
      "waiting",
    );

    await appendText(leader, "Before takeover");
    await expectDocument(follower, "Before takeover");
    await expectDurableAfter(leader, 0);
    const bytesBeforeTakeover = await storageBytes(follower);
    await leader.page.close();

    await expect(follower.demo).toHaveAttribute(
      "data-persistence-leader",
      "leader",
    );
    await appendText(follower, " + after takeover");
    await expectDocument(follower, "Before takeover + after takeover");
    await expectDurableAfter(follower, bytesBeforeTakeover);

    await follower.page.reload();
    await expect(follower.demo).toHaveAttribute("data-room-id", roomId);
    await expectDocument(follower, "Before takeover + after takeover");
    await expect(follower.demo).toHaveAttribute(
      "data-persistence-leader",
      "leader",
    );
  });
});
