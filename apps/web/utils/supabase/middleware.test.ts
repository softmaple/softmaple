import { beforeEach, describe, expect, it, vi } from "vitest";

const getUser = vi.hoisted(() => vi.fn());
const createServerClient = vi.hoisted(() => vi.fn());
const resolveSupabasePublicConfig = vi.hoisted(() =>
  vi.fn(() => ({
    publishableKey: "test-key",
    url: "https://example.supabase.co",
  })),
);

vi.mock("@supabase/ssr", () => ({
  createServerClient,
}));

vi.mock("./config", () => ({
  resolveSupabasePublicConfig,
}));

describe("updateSession protected-route redirects", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createServerClient.mockImplementation((_url, _key, options) => {
      options.cookies.getAll();
      options.cookies.setAll([
        { name: "sb-access-token", value: "refreshed", options: {} },
        {
          name: "sb-refresh-token",
          value: "",
          options: { maxAge: 0 },
        },
      ]);
      return {
        auth: {
          getUser,
        },
      };
    });
  });

  it("redirects unauthenticated workspace Settings requests to login with next", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const { updateSession } = await import("./middleware");
    const request = {
      cookies: {
        getAll: () => [],
        set: vi.fn(),
      },
      nextUrl: {
        clone() {
          return new URL(
            "http://localhost:3000/workspace/acme/settings?tab=members",
          );
        },
        pathname: "/workspace/acme/settings",
        search: "?tab=members",
      },
    };

    const response = await updateSession(request as never);
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/login?next=%2Fworkspace%2Facme%2Fsettings%3Ftab%3Dmembers",
    );
    expect(response.cookies.get("sb-access-token")?.value).toBe("refreshed");
    expect(response.cookies.get("sb-refresh-token")?.value).toBe("");
  });

  it("allows authenticated workspace requests through", async () => {
    getUser.mockResolvedValue({
      data: { user: { id: "user-1" } },
    });
    const { updateSession } = await import("./middleware");
    const request = {
      cookies: {
        getAll: () => [{ name: "sb", value: "1" }],
        set: vi.fn(),
      },
      nextUrl: {
        clone() {
          return new URL("http://localhost:3000/workspace/acme/settings");
        },
        pathname: "/workspace/acme/settings",
        search: "",
      },
    };

    const response = await updateSession(request as never);
    expect(response.status).toBe(200);
    expect(response.cookies.get("sb-access-token")?.value).toBe("refreshed");
  });
});
