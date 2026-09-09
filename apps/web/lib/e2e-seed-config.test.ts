import { describe, expect, it } from "vitest";
import { allowsLocalSeed } from "./e2e-seed-config";

describe("local test seeding", () => {
  const environment = {
    NODE_ENV: "development",
    E2E_ALLOW_LOCAL_SEED: "true",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  };
  it("requires explicit local app and database isolation", () => {
    expect(
      allowsLocalSeed(environment, "http://127.0.0.1:32110/api/e2e/seed"),
    ).toBe(true);
    for (const url of [
      "https://example.com",
      "http://localhost.example.com",
      "invalid",
    ]) {
      expect(allowsLocalSeed(environment, url)).toBe(false);
      expect(
        allowsLocalSeed(
          { ...environment, NEXT_PUBLIC_SUPABASE_URL: url },
          "http://localhost:32110",
        ),
      ).toBe(false);
    }
  });
  it("never enables seeding in production or without opt-in", () => {
    expect(
      allowsLocalSeed(
        { ...environment, NODE_ENV: "production" },
        "http://localhost",
      ),
    ).toBe(false);
    expect(
      allowsLocalSeed(
        { ...environment, E2E_ALLOW_LOCAL_SEED: undefined },
        "http://localhost",
      ),
    ).toBe(false);
  });
});
