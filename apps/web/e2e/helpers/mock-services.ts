/**
 * Mock external services for faster E2E tests
 * Reduces network calls and improves test speed
 */
import { Page } from "@playwright/test";

/**
 * Mock all external API calls
 */
export async function mockExternalServices(page: Page) {
  // Mock Supabase API calls (beyond auth)
  await page.route("**/rest/v1/**", (route) => {
    // Mock database queries
    if (route.request().method() === "GET") {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([]), // Return empty array for list queries
      });
    } else if (route.request().method() === "POST") {
      route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({
          id: "mock-id",
          ...JSON.parse(route.request().postData() || "{}"),
        }),
      });
    } else if (
      route.request().method() === "PATCH" ||
      route.request().method() === "PUT"
    ) {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "mock-id",
          ...JSON.parse(route.request().postData() || "{}"),
        }),
      });
    } else if (route.request().method() === "DELETE") {
      route.fulfill({ status: 204 });
    } else {
      route.continue();
    }
  });

  // Mock any analytics or tracking
  await page.route("**/google-analytics.com/**", (route) => route.abort());
  await page.route("**/googletagmanager.com/**", (route) => route.abort());
  await page.route("**/plausible.io/**", (route) => route.abort());
  await page.route("**/segment.io/**", (route) => route.abort());

  // Mock fonts and external assets to speed up page load
  await page.route("**/fonts.googleapis.com/**", (route) => {
    route.fulfill({
      status: 200,
      contentType: "text/css",
      body: "/* mocked font */",
    });
  });
  await page.route("**/fonts.gstatic.com/**", (route) => route.abort());

  // Mock CDN assets
  await page.route("**/unpkg.com/**", (route) => route.abort());
  await page.route("**/cdn.jsdelivr.net/**", (route) => route.abort());
  await page.route("**/cdnjs.cloudflare.com/**", (route) => route.abort());
}

/**
 * Mock specific workspace data
 */
export async function mockWorkspaceData(
  page: Page,
  workspaceSlug: string = "test-workspace",
) {
  await page.route(
    `**/rest/v1/workspaces?slug=eq.${workspaceSlug}*`,
    (route) => {
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: "workspace-1",
            slug: workspaceSlug,
            name: "Test Workspace",
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            owner_id: "test-user-id",
          },
        ]),
      });
    },
  );

  // Mock workspace members
  await page.route(`**/rest/v1/workspace_members*`, (route) => {
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          id: "member-1",
          workspace_id: "workspace-1",
          user_id: "test-user-id",
          role: "owner",
          created_at: new Date().toISOString(),
        },
      ]),
    });
  });
}

/**
 * Mock document data
 */
export async function mockDocumentData(
  page: Page,
  docSlug: string = "test-doc",
) {
  await page.route(`**/rest/v1/documents?slug=eq.${docSlug}*`, (route) => {
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          id: "doc-1",
          slug: docSlug,
          title: "Test Document",
          content:
            '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Hello World"}]}]}',
          workspace_id: "workspace-1",
          created_by: "test-user-id",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ]),
    });
  });
}

/**
 * Mock all external services with default data
 * Use this as a one-liner in tests that don't need specific data
 */
export async function mockAllServices(page: Page) {
  await mockExternalServices(page);
  await mockWorkspaceData(page);
  await mockDocumentData(page);
}

/**
 * Mock network delays to speed up tests
 */
export async function mockFastNetwork(page: Page) {
  // Override fetch to resolve immediately for mocked routes
  await page.addInitScript(() => {
    const originalFetch = window.fetch;
    window.fetch = async (...args) => {
      const urlString = args[0]?.toString() || "";

      // Safely parse URL for hostname validation
      let isAllowedEndpoint = false;
      try {
        const parsedUrl = new URL(urlString, window.location.origin);
        const hostname = parsedUrl.hostname;
        const pathname = parsedUrl.pathname;

        // Validate specific hostnames instead of using substring matching
        const isSupabaseAPI =
          (hostname.endsWith(".supabase.co") || hostname === "supabase.co") &&
          pathname.includes("/rest/v1/");
        const isSupabaseAuth =
          (hostname.endsWith(".supabase.co") || hostname === "supabase.co") &&
          pathname.includes("/auth/");
        isAllowedEndpoint = isSupabaseAPI || isSupabaseAuth;
      } catch (e) {
        // Invalid URL, treat as local/relative
        isAllowedEndpoint = urlString.includes("/rest/v1/");
      }

      // Instantly resolve for known mock endpoints
      if (isAllowedEndpoint) {
        // Add artificial 10ms delay to prevent race conditions
        await new Promise((resolve) => setTimeout(resolve, 10));
      }

      return originalFetch(...args);
    };
  });
}
