import { beforeEach, describe, expect, it, vi } from "vitest";

const updateSession = vi.hoisted(() => vi.fn());

vi.mock("@/utils/supabase/middleware", () => ({
  updateSession,
}));

describe("web proxy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateSession.mockResolvedValue(new Response("ok"));
  });

  it("delegates every request to the Supabase session updater", async () => {
    const { proxy } = await import("./proxy");
    const request = new Request("http://localhost:3000/docs/example", {
      method: "GET",
    });

    const response = await proxy(request as never);

    expect(updateSession).toHaveBeenCalledWith(request);
    expect(response).toBeInstanceOf(Response);
  });

  it("does not special-case collaboration WebSocket upgrades", async () => {
    const { proxy } = await import("./proxy");
    const request = new Request("http://localhost:3000/collab/document", {
      method: "GET",
      headers: {
        connection: "Upgrade",
        upgrade: "websocket",
        "sec-websocket-version": "13",
        "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
        origin: "http://localhost:3000",
      },
    });

    await proxy(request as never);

    expect(updateSession).toHaveBeenCalledTimes(1);
  });
});
