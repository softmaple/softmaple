import { expect, test } from "@playwright/test";
import {
  appendText,
  expectDocument,
  openRoom,
  openSecondTab,
  roomFor,
} from "./helpers/lexical-eg-walker";

test.describe("Lexical EG-walker BroadcastChannel transport", () => {
  test("still syncs via BroadcastChannel when transport=broadcast", async ({
    context,
    page,
  }, testInfo) => {
    const roomId = roomFor(testInfo);
    const first = await openRoom(page, roomId, "broadcast");
    const second = await openSecondTab(context, roomId, "broadcast");

    await expect(first.status).toContainText("Tabs connected");
    await appendText(first, "Broadcast only");
    await expectDocument(second, "Broadcast only");
  });
});
