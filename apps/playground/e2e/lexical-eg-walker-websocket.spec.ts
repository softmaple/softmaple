import { expect, test } from "@playwright/test";
import {
  appendText,
  expectDocument,
  openRoom,
  roomFor,
} from "./helpers/lexical-eg-walker";

test.describe("Lexical EG-walker WebSocket cross-browser", () => {
  test("synchronizes text between two browser contexts over WebSocket", async ({
    browser,
  }, testInfo) => {
    const roomId = roomFor(testInfo);
    const contextA = await browser.newContext();
    const contextB = await browser.newContext();
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    try {
      const first = await openRoom(pageA, roomId, "websocket");
      const second = await openRoom(pageB, roomId, "websocket");

      await expect(first.status).toContainText("WebSocket connected");
      await expect(second.status).toContainText("WebSocket connected");

      await appendText(first, "Hello across browsers");
      await expectDocument(second, "Hello across browsers");

      await appendText(second, " + reply");
      await expectDocument(first, "Hello across browsers + reply");
      await expectDocument(second, "Hello across browsers + reply");
    } finally {
      await contextA.close();
      await contextB.close();
    }
  });
});
