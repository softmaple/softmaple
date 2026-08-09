import { defineConfig, devices } from "@playwright/test";

const integerPort = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < 1_024 || parsed > 65_535) {
    throw new Error("E2E ports must be integers between 1024 and 65535");
  }
  return parsed;
};

const webPort = integerPort(process.env.E2E_WEB_PORT, 32_110);
const collabPort = integerPort(process.env.E2E_COLLAB_PORT, 32_111);
const baseURL = `http://127.0.0.1:${webPort}`;
const collabOrigin = `http://127.0.0.1:${collabPort}`;
const gatewayKeyId = "playwright-2026";
const gatewaySecret = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8";

process.env.E2E_BASE_URL = baseURL;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : 1,
  reporter: process.env.CI ? "github" : "html",
  timeout: 45_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    actionTimeout: 10_000,
    navigationTimeout: 25_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: [
    {
      command: `pnpm exec nitro dev --port ${collabPort}`,
      cwd: "../collab",
      env: {
        ...process.env,
        COLLAB_GATEWAY_HMAC_KEYS: JSON.stringify({
          [gatewayKeyId]: gatewaySecret,
        }),
        SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
        SUPABASE_PUBLISHABLE_KEY:
          process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
          "",
      },
      reuseExistingServer: false,
      timeout: 120_000,
      url: `${collabOrigin}/health`,
    },
    {
      command: `pnpm exec next dev --port ${webPort}`,
      cwd: ".",
      env: {
        ...process.env,
        COLLAB_BACKEND_ORIGIN: collabOrigin,
        COLLAB_GATEWAY_HMAC_KEY_ID: gatewayKeyId,
        COLLAB_GATEWAY_HMAC_SECRET: gatewaySecret,
        NEXT_PUBLIC_APP_URL: baseURL,
      },
      reuseExistingServer: false,
      timeout: 120_000,
      url: baseURL,
    },
  ],
});
