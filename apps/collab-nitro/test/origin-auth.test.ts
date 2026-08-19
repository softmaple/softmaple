import { afterEach, describe, expect, it, vi } from "vitest";
import { authenticateBrowserOrigin } from "../server/utils/origin-auth";

afterEach(() => {
  vi.unstubAllEnvs();
});

const rejectionFrom = async (run: () => unknown): Promise<Response> => {
  try {
    run();
    throw new Error("expected upgrade rejection");
  } catch (error) {
    expect(error).toBeInstanceOf(Response);
    return error as Response;
  }
};

describe("authenticateBrowserOrigin", () => {
  it("accepts configured and Vercel preview origins", () => {
    const context = authenticateBrowserOrigin(
      new Request("http://localhost:3002/collab/document", {
        headers: { origin: "https://softmaple.ink" },
      }),
      {
        COLLAB_ALLOWED_ORIGINS: "https://softmaple.ink",
        VERCEL_URL: "softmaple-git-feature-team.vercel.app",
      },
    );
    expect(context).toEqual({ browserOrigin: "https://softmaple.ink" });

    const preview = authenticateBrowserOrigin(
      new Request("http://localhost:3002/collab/document", {
        headers: {
          origin: "https://softmaple-git-feature-team.vercel.app",
        },
      }),
      {
        VERCEL_URL: "softmaple-git-feature-team.vercel.app",
      },
    );
    expect(preview).toEqual({
      browserOrigin: "https://softmaple-git-feature-team.vercel.app",
    });
  });

  it("rejects missing or unknown origins", async () => {
    const missing = await rejectionFrom(() =>
      authenticateBrowserOrigin(
        new Request("http://localhost:3002/collab/document"),
        { COLLAB_ALLOWED_ORIGINS: "https://softmaple.ink" },
      ),
    );
    expect(missing.status).toBe(403);
    expect(await missing.text()).toBe("Forbidden");

    const unknown = await rejectionFrom(() =>
      authenticateBrowserOrigin(
        new Request("http://localhost:3002/collab/document", {
          headers: { origin: "https://evil.example" },
        }),
        { COLLAB_ALLOWED_ORIGINS: "https://softmaple.ink" },
      ),
    );
    expect(unknown.status).toBe(403);
    expect(await unknown.text()).toBe("Forbidden");

    const emptyConfig = await rejectionFrom(() =>
      authenticateBrowserOrigin(
        new Request("http://localhost:3002/collab/document", {
          headers: { origin: "https://softmaple.ink" },
        }),
        {},
      ),
    );
    expect(emptyConfig.status).toBe(403);
    expect(await emptyConfig.text()).toBe("Forbidden");
  });

  it("normalizes trailing-slash allowed origins", () => {
    const context = authenticateBrowserOrigin(
      new Request("http://localhost:3002/collab/document", {
        headers: { origin: "https://softmaple.ink" },
      }),
      {
        COLLAB_ALLOWED_ORIGINS: "https://softmaple.ink/",
      },
    );
    expect(context).toEqual({ browserOrigin: "https://softmaple.ink" });
  });
});
