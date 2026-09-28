import type { Page } from "@playwright/test";

type SeedWorkspace = {
  readonly id: number;
  readonly slug: string;
  readonly title: string;
};

export type E2ESeed = {
  readonly document: {
    readonly id: string;
    readonly slug: string;
    readonly title: string;
  };
  readonly editor: { readonly email: string; readonly password: string };
  readonly owner: { readonly email: string; readonly password: string };
  /** Workspace owned by seed.owner with no viewer/editor membership. */
  readonly ownerOnlyWorkspace: SeedWorkspace;
  readonly viewer: { readonly email: string; readonly password: string };
  /** Shared workspace where viewer is a member. */
  readonly workspace: SeedWorkspace;
};

/** A dedicated account plus the token hash a reset email would carry. */
export type E2ERecovery = {
  readonly email: string;
  readonly password: string;
  readonly tokenHash: string;
};

const seedRequest = async (
  action: "cleanup" | "recovery" | "seed",
  runId: string,
) => {
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

export const createRecovery = async (runId: string): Promise<E2ERecovery> =>
  (await (await seedRequest("recovery", runId)).json()) as E2ERecovery;

export const cleanupSeed = async (runId: string): Promise<void> => {
  await seedRequest("cleanup", runId);
};

export const login = async (
  page: Page,
  credentials: { readonly email: string; readonly password: string },
): Promise<void> => {
  await page.goto("/login");
  // Exact labels: "Password" would also match the "Show password" toggle.
  await page.getByLabel("Email", { exact: true }).fill(credentials.email);
  await page.getByLabel("Password", { exact: true }).fill(credentials.password);
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await page.waitForURL("**/dashboard");
};
