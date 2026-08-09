import { afterEach, describe, expect, it, vi } from "vitest";
import { authenticateBrowserOrigin } from "../server/utils/origin-auth";

afterEach(() => {
  vi.unstubAllEnvs();
});

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
    await expect(
      Promise.resolve().then(() =>
        authenticateBrowserOrigin(
          new Request("http://localhost:3002/collab/document"),
          { COLLAB_ALLOWED_ORIGINS: "https://softmaple.ink" },
        ),
      ),
    ).rejects.toMatchObject({ status: 403 });

    await expect(
      Promise.resolve().then(() =>
        authenticateBrowserOrigin(
          new Request("http://localhost:3002/collab/document", {
            headers: { origin: "https://evil.example" },
          }),
          { COLLAB_ALLOWED_ORIGINS: "https://softmaple.ink" },
        ),
      ),
    ).rejects.toMatchObject({ status: 403 });
  });
});
