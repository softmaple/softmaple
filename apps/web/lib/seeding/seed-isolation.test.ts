import { describe, expect, it } from "vitest";
import {
  isLoopbackUrl,
  projectRefFromUrl,
  resolveSeedConfiguration,
  SEED_ISOLATION,
  type SeedEnvironment,
} from "@/lib/seeding/seed-isolation";

const credentials = {
  SUPABASE_SERVICE_ROLE_KEY: "service-role",
  E2E_SEED_SECRET: "secret",
} as const;

const environment = (extra: SeedEnvironment): SeedEnvironment => ({
  ...credentials,
  ...extra,
});

describe("resolveSeedConfiguration", () => {
  it("refuses when nothing is configured", () => {
    expect(() => resolveSeedConfiguration({})).toThrow(/not safely isolated/);
  });

  it("accepts an explicitly enabled loopback stack", () => {
    const config = resolveSeedConfiguration(
      environment({
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
        E2E_ALLOW_LOCAL_SEED: "true",
      }),
    );
    expect(config.isolation).toBe(SEED_ISOLATION.Local);
  });

  it("refuses a loopback stack that was not opted into", () => {
    expect(() =>
      resolveSeedConfiguration(
        environment({ NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321" }),
      ),
    ).toThrow(/not safely isolated/);
  });

  it("never lets the local switch reach a remote project", () => {
    expect(() =>
      resolveSeedConfiguration(
        environment({
          NEXT_PUBLIC_SUPABASE_URL: "https://live.supabase.co",
          E2E_ALLOW_LOCAL_SEED: "true",
        }),
      ),
    ).toThrow(/not safely isolated/);
  });

  it("keeps the remote project-ref match", () => {
    const remote = environment({
      NEXT_PUBLIC_SUPABASE_URL: "https://testing.supabase.co",
      E2E_ALLOW_REMOTE_SEED: "true",
      E2E_SUPABASE_PROJECT_REF: "testing",
    });
    expect(resolveSeedConfiguration(remote).isolation).toBe(
      SEED_ISOLATION.Remote,
    );
    expect(() =>
      resolveSeedConfiguration({
        ...remote,
        E2E_SUPABASE_PROJECT_REF: "other",
      }),
    ).toThrow(/not safely isolated/);
  });

  it("still refuses the production project", () => {
    expect(() =>
      resolveSeedConfiguration(
        environment({
          NEXT_PUBLIC_SUPABASE_URL: "https://prod.supabase.co",
          E2E_ALLOW_REMOTE_SEED: "true",
          E2E_SUPABASE_PROJECT_REF: "prod",
          SUPABASE_PRODUCTION_PROJECT_REF: "prod",
        }),
      ),
    ).toThrow(/not safely isolated/);
  });
});

describe("url helpers", () => {
  it("recognises only loopback hosts", () => {
    expect(isLoopbackUrl("http://127.0.0.1:54321")).toBe(true);
    expect(isLoopbackUrl("http://localhost:54321")).toBe(true);
    expect(isLoopbackUrl("http://stack.localhost")).toBe(true);
    expect(isLoopbackUrl("https://live.supabase.co")).toBe(false);
    expect(isLoopbackUrl("not a url")).toBe(false);
  });

  it("extracts hosted project refs only", () => {
    expect(projectRefFromUrl("https://abc.supabase.co")).toBe("abc");
    expect(projectRefFromUrl("http://127.0.0.1:54321")).toBeNull();
    expect(projectRefFromUrl("https://abc.example.com")).toBeNull();
  });
});
