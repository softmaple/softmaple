import { randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";
import { createSeed, cleanupSeed, login } from "./helpers/seed";

test("independent users preserve their editor through views, invitations and return", async ({
  browser,
}) => {
  const runId = `attention-${randomBytes(6).toString("hex")}`;
  const seed = await createSeed(runId);
  const ownerContext = await browser.newContext();
  const editorContext = await browser.newContext();
  try {
    const owner = await ownerContext.newPage();
    const editor = await editorContext.newPage();
    await editor.addInitScript(() => {
      const NativeWebSocket = window.WebSocket;
      window.WebSocket = class extends NativeWebSocket {
        constructor(url: string | URL, protocols?: string | string[]) {
          super(url, protocols);
          if (new URL(url, location.href).pathname === "/collab/presence")
            Object.defineProperty(window, "testPresenceSocket", {
              configurable: true,
              value: this,
            });
        }
      };
    });
    await login(owner, seed.owner);
    await login(editor, seed.editor);
    const url = `/workspace/${seed.workspace.slug}/doc/${seed.document.slug}`;
    await owner.goto(url);
    const writing = owner.getByRole("textbox", { name: "Rich text editor" });
    await expect(writing).toHaveAttribute("contenteditable", "true");
    await writing.fill("A shared passage that preserves our place.");
    await writing.evaluate((node) =>
      node.setAttribute("data-session-proof", "original"),
    );
    await owner.getByRole("tab", { name: "Markdown", exact: true }).click();
    await expect(owner.locator("pre")).toContainText("A shared passage");
    await owner.getByRole("tab", { name: "Editor", exact: true }).click();
    await expect(writing).toHaveAttribute("data-session-proof", "original");
    await owner.getByRole("button", { name: "Share", exact: true }).click();
    await expect(
      owner.getByRole("button", { name: "Disable link", exact: true }),
    ).toBeVisible();
    await editor.goto(url);
    await expect(
      editor.getByRole("button", { name: "Present my place", exact: true }),
    ).toBeVisible();
    const receiver = editor.getByRole("textbox", { name: "Rich text editor" });
    await receiver.click();
    await editor.keyboard.press("ControlOrMeta+End");
    await editor.keyboard.insertText(" Receiver keeps writing.");
    await expect(writing).toContainText("Receiver keeps writing.");
    await writing.click();
    await owner.keyboard.press("ControlOrMeta+Home");
    await owner.getByRole("button", { name: "People and activity" }).click();
    await owner.getByRole("checkbox", { name: /E2E Editor/ }).check();
    await owner
      .getByRole("button", { name: "Present my place", exact: true })
      .click();
    await receiver.click();
    const previousSelection = await receiver.evaluate(() =>
      window.getSelection()?.toString(),
    );
    await owner.getByRole("button", { name: "Look here", exact: true }).click();
    await expect(
      editor.getByRole("button", { name: "Open here", exact: true }),
    ).toBeVisible();
    await expect(receiver).toBeFocused();
    expect(
      await receiver.evaluate(() => window.getSelection()?.toString()),
    ).toBe(previousSelection);
    await editor
      .getByRole("button", { name: "Open here", exact: true })
      .click();
    await expect(
      editor.getByRole("textbox", { name: "Shared context, read only" }),
    ).toHaveAttribute("contenteditable", "false");
    await editor
      .getByRole("button", { name: "Follow presenter", exact: true })
      .click();
    await expect(
      editor.getByText("Following E2E Owner", { exact: true }),
    ).toBeVisible();
    await receiver.click();
    await editor.keyboard.insertText(" Local intent suspends following.");
    await expect(
      editor.getByRole("button", { name: "Resume", exact: true }),
    ).toBeVisible();
    await editor.getByRole("button", { name: "Resume", exact: true }).click();
    await expect(
      editor.getByText("Following E2E Owner", { exact: true }),
    ).toBeVisible();
    // A new transport connection must never silently restore following.
    await editor.evaluate(() => {
      const socket: unknown = Reflect.get(window, "testPresenceSocket");
      if (!(socket instanceof WebSocket))
        throw new Error("Presence transport unavailable");
      socket.close(4000, "Local reconnect verification");
    });
    await expect(
      editor.getByRole("button", { name: "Resume", exact: true }),
    ).toBeVisible();
    await expect(
      editor.getByText("Following E2E Owner", { exact: true }),
    ).toHaveCount(0);
    await expect(
      editor.getByRole("button", { name: "Resume", exact: true }),
    ).toBeEnabled();
    await editor.getByRole("button", { name: "Resume", exact: true }).click();
    await expect(
      editor.getByText("Following E2E Owner", { exact: true }),
    ).toBeVisible();
    await owner
      .getByRole("button", { name: "Stop presenting", exact: true })
      .click();
    await expect(
      editor.getByText("Presentation ended. Your place is still available.", {
        exact: true,
      }),
    ).toBeVisible();
    await editor
      .getByRole("button", { name: "Return to my place", exact: true })
      .click();
    await expect(
      editor.getByRole("textbox", { name: "Shared context, read only" }),
    ).toHaveCount(0);
    await expect(receiver).toContainText("Receiver keeps writing.");
    await expect(writing).toContainText("Local intent suspends following.");
    await expect(writing).toHaveAttribute("data-session-proof", "original");
  } finally {
    await ownerContext.close();
    await editorContext.close();
    await cleanupSeed(runId);
  }
});
