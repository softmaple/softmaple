import {
  type BrowserContext,
  expect,
  type Locator,
  type Page,
  type TestInfo,
} from "@playwright/test";

export interface RoomPage {
  readonly demo: Locator;
  readonly editor: Locator;
  readonly page: Page;
  readonly status: Locator;
}

export const roomFor = (testInfo: TestInfo): string =>
  `pw-${testInfo.workerIndex}-${testInfo.retry}-${Date.now()}-${crypto
    .randomUUID()
    .replaceAll("-", "")
    .slice(0, 6)}`;

export const openRoom = async (
  page: Page,
  roomId: string,
  transport: "websocket" | "broadcast" = "websocket",
): Promise<RoomPage> => {
  await page.goto(
    `/demo/lexical-eg-walker?room=${roomId}&transport=${transport}`,
  );

  const demo = page.getByTestId("lexical-eg-walker-demo");
  const editor = page.getByRole("textbox", { name: "Rich text editor" });
  const status = page.getByTestId("collaboration-status");
  await expect(page.getByTestId("lexical-room-ready")).toBeVisible();
  await expect(editor).toHaveAttribute("contenteditable", "true");
  await expect(demo).toHaveAttribute("data-room-id", roomId);
  await expect(demo).toHaveAttribute("data-transport", transport);
  await expect(status).toHaveAttribute("data-transport", transport);
  await expect(demo).toHaveAttribute("data-persistence-mode", "persistent");
  await expect(status).not.toContainText("Unsaved · memory only");
  await expect(page.getByRole("button", { name: "Undo" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Redo" })).toHaveCount(0);

  return { demo, editor, page, status };
};

export const appendText = async (
  roomPage: RoomPage,
  text: string,
): Promise<void> => {
  await roomPage.editor.click();
  await roomPage.editor.press("End");
  await roomPage.editor.pressSequentially(text, { delay: 15 });
};

export const expectDocument = async (
  roomPage: RoomPage,
  text: string,
): Promise<void> => {
  await expect(roomPage.editor).toHaveText(text);
  await expect(roomPage.page.getByRole("alert")).toHaveCount(0);
};

export const storageBytes = async (roomPage: RoomPage): Promise<number> =>
  Number((await roomPage.demo.getAttribute("data-storage-bytes")) ?? "0");

export const expectDurableAfter = async (
  roomPage: RoomPage,
  previousBytes: number,
): Promise<void> => {
  await expect(roomPage.demo).toHaveAttribute(
    "data-persistence-durability",
    "saved",
  );
  await expect
    .poll(() => storageBytes(roomPage), {
      message: "the newly acknowledged batch should increase durable storage",
    })
    .toBeGreaterThan(previousBytes);
};

export const openSecondTab = async (
  context: BrowserContext,
  roomId: string,
  transport: "websocket" | "broadcast" = "websocket",
): Promise<RoomPage> => openRoom(await context.newPage(), roomId, transport);
