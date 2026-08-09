import type { Page } from "@playwright/test";

export type E2ESeed = {
  readonly document: {
    readonly id: string;
    readonly slug: string;
    readonly title: string;
  };
  readonly editor: { readonly email: string; readonly password: string };
  readonly owner: { readonly email: string; readonly password: string };
  readonly viewer: { readonly email: string; readonly password: string };
  readonly workspace: {
    readonly id: number;
    readonly slug: string;
    readonly title: string;
  };
};

const seedRequest = async (action: "cleanup" | "seed", runId: string) => {
  const baseUrl = process.env.E2E_BASE_URL;
  const secret = process.env.E2E_SEED_SECRET;
  if (baseUrl === undefined || secret === undefined) {
    throw new Error("E2E_BASE_URL and E2E_SEED_SECRET are required");
  }
  const response = await fetch(`${baseUrl}/api/e2e/seed`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${secret}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ action, runId }),
  });
  if (!response.ok) {
    throw new Error(`E2E ${action} failed with ${response.status}`);
  }
  return response;
};

export const createSeed = async (runId: string): Promise<E2ESeed> =>
  (await (await seedRequest("seed", runId)).json()) as E2ESeed;

export const cleanupSeed = async (runId: string): Promise<void> => {
  await seedRequest("cleanup", runId);
};

export const login = async (
  page: Page,
  credentials: E2ESeed["owner"] | E2ESeed["editor"] | E2ESeed["viewer"],
): Promise<void> => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(credentials.email);
  await page.getByLabel("Password").fill(credentials.password);
  await page.getByRole("button", { name: /^Sign in$/i }).click();
  await page.waitForURL("**/dashboard");
};
